# Salons — contrat back-end pour le front

Les salons sont disponibles sur la branche `feat/lobbies`. Le front Vue déjà présent reste sous la responsabilité du collègue : cette livraison ne remplace pas ses données simulées par des appels réseau. Le démarrage d'une partie, les rôles et les événements Socket.IO restent à développer.

Toutes les routes exigent une session valide. Pour les mutations, reprendre le parcours de [l'authentification](authentication.md) : `credentials: include`, `Origin` égal à `APP_ORIGIN` et `X-CSRF-Token` courant. Les réponses ne sont pas mises en cache et utilisent HAL pour les ressources.

## Créer un salon

`POST /api/lobbies` :

```json
{
  "name": "Le village des amis",
  "visibility": "PRIVATE",
  "capacity": 8,
  "discussionDurationSeconds": 180,
  "voteDurationSeconds": 60,
  "nightDurationSeconds": 60
}
```

Seul `name` est obligatoire. Valeurs par défaut : visibilité `PUBLIC`, capacité 12, durées 180/60/60. Nom nettoyé des espaces périphériques, 3 à 80 caractères, sans caractères de contrôle ; capacité entière 6 à 12, durées entières 30 à 300 secondes. Les champs supplémentaires, dont `ownerId` ou `status`, sont refusés.

Réponse 201, `Location: /api/lobbies/{id}`, état `WAITING`, créateur membre et propriétaire, effectif initial 1. Les champs sont : id, name, visibility, status, capacity, memberCount, owner (id et username), trois durées, createdAt, members et `_links`.

Un salon privé ajoute `invitationCode` à cette unique réponse de création : 24 caractères hexadécimaux aléatoires, soit 96 bits. Le code n'est ni un ID de salon ni un mot de passe de compte. Seule son empreinte SHA-256 est stockée. Le créateur doit conserver le code ou transmettre l'invitation au moment de la création : les lectures ultérieures ne le renvoient pas, même au propriétaire. Régénération et modification des réglages sont hors de ce lot.

L'invitation doit transmettre **l'identifiant du salon et le code**. Le contrat actuel ne comporte pas de recherche de salon à partir du seul code.

## Liste et détail

- `GET /api/lobbies?page=1&pageSize=25` : uniquement salons `PUBLIC` en état `WAITING`, y compris ceux déjà complets. Aucune liste de salons privés.
- Réponse : `{ page, pageSize, total, _embedded: { lobbies: [...] }, _links }`. Les résumés incluent les réglages, propriétaire et effectif, sans liste des membres ni données privées.
- Liens HAL : `self`, `first`, `last`, et `prev`/`next` lorsque pertinents. Une page valide au-delà du total est vide ; `last` reste au moins 1, et `prev` d'une page hors plage pointe vers la dernière page utile.
- `page` et `pageSize` sont des entiers décimaux positifs, taille 1 à 100 ; paramètres répétés, inconnus ou invalides refusés. Le décalage calculé doit rester inférieur ou égal à 2 147 483 647.
- Ordre stable : createdAt décroissant puis id décroissant. Compte total et page sont lus dans le même snapshot PostgreSQL.
- `GET /api/lobbies/{id}` : salon public en attente ou salon dont l'utilisateur est membre actif. Le détail ajoute les membres : userId, username et joinedAt. Un salon privé dont on n'est pas membre renvoie 404, même avec un code valide ; il faut d'abord le rejoindre.

Aucun e-mail, hash de mot de passe, empreinte d'invitation ou historique de départ n'est inclus dans ces représentations. Les membres sont des utilisateurs du salon ; ils n'ont pas encore de rôle de jeu.

## Rejoindre et quitter

| Route | Corps | Succès |
| --- | --- | --- |
| `POST /api/lobbies/{id}/memberships` | `{}` pour public ; `{ "invitationCode": "..." }` pour privé | 201 et `Location` vers sa participation |
| `GET /api/lobbies/{id}/memberships/me` | Aucun | 200, participation active personnelle |
| `DELETE /api/lobbies/{id}/memberships/me` | Aucun | 204 |

Le code accepte les minuscules et espaces périphériques ; un code fourni doit respecter le format de 24 caractères hexadécimaux. Code privé absent ou faux, salon inexistant ou adhésion privée non autorisée : 404 générique. Un code mal formé est rejeté en 400 avant la recherche. Un utilisateur déjà membre peut lire le salon sans renvoyer son code, mais une nouvelle adhésion est refusée avec 409.

La participation retournée contient id, lobbyId, userId, username, joinedAt et `_links.self`/`_links.lobby`. Utiliser ce dernier lien pour relire l'effectif à jour après une arrivée ou un départ.

Les arrivées sont refusées si le salon est plein ou n'est plus en attente. Les départs sont autorisés uniquement aux membres actifs et avant le lancement. Le départ ne supprime pas la ligne d'historique : leftAt est renseigné ; une réadhésion ultérieure crée une nouvelle ligne active si le salon est toujours ouvert et le code privé fourni.

Si le propriétaire part, la propriété passe au membre restant arrivé le plus tôt, départagé par ID de participation en cas d'égalité d'horodatage. Le dernier départ ferme le salon ; un salon `CLOSED` ne se rouvre pas. Une déconnexion HTTP/réseau ne provoque aucun départ automatique. Un utilisateur peut appartenir à plusieurs salons ; aucune restriction à un seul salon n'a été ajoutée.

## Erreurs et limites

- 400 `VALIDATION_ERROR` ou `INVALID_LOBBY` : identifiant UUID, corps, réglages ou pagination invalides.
- 401 `UNAUTHENTICATED` ou `SESSION_EXPIRED` : utilisateur non authentifié ou session expirée.
- 403 : Origin/CSRF invalide, vérifié avant les mutations.
- 404 `LOBBY_NOT_FOUND` : salon/participation inaccessible, code faux ou ressource absente. Une lecture ne confirme pas l'existence d'un salon privé à un tiers.
- 409 `ALREADY_MEMBER`, `LOBBY_FULL` ou `LOBBY_NOT_WAITING` : conflit avec l'état courant.
- 429 : limite globale API, création (10/minute/IP) ou tentative d'entrée (10/minute/IP), avec `Retry-After`. Les tentatives incorrectes comptent aussi.
- 500/503 : erreur interne ou contrôle Redis indisponible, sans détail privé.

Après un échec réseau lors d'une création, ne pas rejouer aveuglément la requête : la création de salons n'est pas idempotente. Après une entrée incertaine, lire sa participation avant de réessayer. Les autres membres doivent relire le détail ; aucune notification `lobby:updated` n'est encore émise et Socket.IO reste fermé.

## Garanties de persistance et concurrence

Les tables Lobby et LobbyMembership sont ajoutées par la migration `20261119000200_create_lobbies`, sans supprimer les comptes. Chaque création enregistre salon et propriétaire membre dans une seule transaction. Une arrivée ou un départ verrouille la ligne parent avec SELECT FOR UPDATE dans une transaction Read Committed, relit les membres puis applique les règles ; le verrou protège aussi entre plusieurs processus API.

Un index PostgreSQL partiel unique sur (lobbyId, userId) pour leftAt IS NULL protège les adhésions actives ; un index classique sert les recherches. L'index partiel et les CHECK de capacité/durées/invitation sont définis explicitement dans la migration et doivent être conservés lors des futures évolutions Prisma. Le futur lancement d'une partie devra prendre le même verrou parent pour fermer atomiquement les inscriptions.

Le propriétaire historique reste référencé sur un salon fermé, même s'il n'y a plus de membre actif. La suppression d'un utilisateur ayant un historique de salons est restreinte par les clés étrangères ; sa politique de suppression reste à concevoir.

## Vérification manuelle avec Swagger

Après `docker compose up -d --build`, les migrations sont appliquées automatiquement. Dans Swagger, récupérer `/api/csrf`, créer/se connecter à un compte et remplacer le jeton CSRF par celui du login. Créer un salon public puis privé ; vérifier liste, détail et participation personnelle. Un second navigateur/profil permet de connecter un autre compte et d'essayer l'invitation, puis le départ et le transfert de propriété.

Les tests automatisés utilisent une base Docker éphémère : les tests de concurrence ne doivent jamais être lancés sur les données réelles. Voir [le guide d'exploitation](../deploy.md).
