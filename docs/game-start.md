# Lancement des parties — contrat back-end

Cette étape permet de démarrer une partie, d'attribuer les rôles et de lire les informations autorisées. Le front du collègue n'est pas modifié. Les actions nocturnes, votes, éliminations, victoire, chats et notifications Socket.IO ne sont pas encore implémentés.

## Routes disponibles

Toutes les routes exigent une session valide, avec les cookies et protections décrits dans [l'authentification](authentication.md).

| Méthode et chemin | Comportement |
| --- | --- |
| `POST /api/lobbies/{lobbyId}/games` | Le propriétaire lance une seule partie ; corps absent ou `{}` uniquement ; Origin et CSRF exigés |
| `GET /api/games/{gameId}` | Un participant lit la projection collective sans rôles |
| `GET /api/games/{gameId}/participants/me` | Le participant lit uniquement son rôle et les coéquipiers autorisés |

Les liens HAL permettent de naviguer entre la partie, le salon et sa participation personnelle. Le détail du salon inclut désormais `gameId` (null avant lancement) et `_links.game` après lancement : les autres membres peuvent ainsi découvrir la partie en relisant le salon, sans connaître la réponse de création du propriétaire.

## Lancer

Préconditions : utilisateur propriétaire et membre actif, salon `WAITING`, de 6 à 12 membres actifs dans la limite de la capacité. Les membres déconnectés restent inscrits et sont inclus ; les membres ayant explicitement quitté ne participent pas. Un membre ordinaire ne peut pas lancer, et un utilisateur extérieur ne peut pas utiliser le lancement pour confirmer l'existence d'un salon privé.

Réponse : **201**, `Location: /api/games/{id}`, document HAL de partie. Aucun rôle n'est retourné dans cette réponse, y compris au propriétaire. Ce dernier consulte ensuite sa route personnelle comme les autres joueurs. Le corps ne permet de choisir ni rôles, ni participants, ni réglages, ni horloge.

Le serveur mélange un paquet de rôles avec Fisher-Yates et `crypto.randomInt` (tirages bornés). La composition est fixée par l'effectif au lancement :

| Joueurs | Loups | Voyante | Villageois |
| --- | --- | --- | --- |
| 6 | 1 | 1 | 4 |
| 7 | 1 | 1 | 5 |
| 8 | 2 | 1 | 5 |
| 9 | 2 | 1 | 6 |
| 10 | 2 | 1 | 7 |
| 11 | 3 | 1 | 7 |
| 12 | 3 | 1 | 8 |

La distribution est persistée une seule fois et ne dépend pas de la session Redis. Une reconnexion ou un redémarrage de l'API ne redistribue rien. Les pseudonymes et trois durées du salon sont copiés dans la partie pour figer l'état initial.

## État collectif

Exemple de structure, avec identifiants et dates illustratifs :

```json
{
  "id": "UUID_PARTIE",
  "lobbyId": "UUID_SALON",
  "status": "IN_PROGRESS",
  "startedAt": "2026-11-19T12:00:00.000Z",
  "finishedAt": null,
  "winner": null,
  "discussionDurationSeconds": 180,
  "voteDurationSeconds": 60,
  "nightDurationSeconds": 60,
  "phase": {
    "id": "UUID_PHASE",
    "type": "NIGHT",
    "cycle": 1,
    "startedAt": "2026-11-19T12:00:00.000Z",
    "deadline": "2026-11-19T12:01:00.000Z"
  },
  "participants": [
    { "id": "UUID_PARTICIPATION", "userId": "UUID_COMPTE", "username": "Alice", "status": "ALIVE", "eliminatedAt": null }
  ],
  "_links": {
    "self": { "href": "/api/games/UUID_PARTIE" },
    "lobby": { "href": "/api/lobbies/UUID_SALON" },
    "participant": { "href": "/api/games/UUID_PARTIE/participants/me" }
  }
}
```

« Collectif » signifie commun aux participants, pas accessible à tout Internet. Les non-participants reçoivent 404, que le salon d'origine soit public ou privé. Aucun rôle, camp individuel, empreinte d'invitation, e-mail ou hash de mot de passe n'est présent dans cet état. Les réponses utilisent `Cache-Control: no-store`.

La première nuit est enregistrée avec son échéance calculée côté serveur. **Aucun ordonnanceur ni passage automatique de phase n'est livré ici** : même après l'échéance, l'état reste sur cette nuit jusqu'à l'implémentation du moteur. L'interface doit présenter cet état comme une étape de développement, sans simuler des actions ou une progression censées être traitées par l'API.

## Rôle personnel

La route `/participants/me` ne prend aucun identifiant de cible. Elle renvoie id, gameId, userId, username, role, team, status, teammates et `_links`.

- `role` : `VILLAGER`, `WEREWOLF` ou `SEER`.
- `team` : `VILLAGE` pour villageois/voyante, `WEREWOLVES` pour les loups.
- `teammates` : autres loups vivants (id, userId, username, status), uniquement si l'appelant est lui-même un loup vivant. Le tableau est vide pour les autres rôles et les morts.
- La voyante ne connaît à ce stade que son propre rôle ; son pouvoir de découverte viendra avec les actions nocturnes.

Les rôles secrets sont liés aux participations de partie et non au compte utilisateur. Les logs ne doivent contenir ni les objets ORM de partie ni les réponses personnelles. Une liste publique de rôles, une route de rôle ciblant un autre joueur et le choix de son rôle par le client ne sont pas exposés.

## Erreurs et verrouillage

- 400 `VALIDATION_ERROR` : UUID invalide ou corps contenant des champs.
- 401 : session absente ou expirée.
- 403 `START_FORBIDDEN` : membre non propriétaire ; les protections Origin/CSRF peuvent également renvoyer 403 avant le traitement métier.
- 404 `LOBBY_NOT_FOUND` ou `GAME_NOT_FOUND` : ressource absente ou utilisateur non autorisé à en connaître l'état.
- 409 `PLAYER_COUNT_INVALID`, `LOBBY_NOT_WAITING` ou `GAME_ALREADY_STARTED` : groupe insuffisant/invalide ou partie déjà lancée.
- 429 : limite globale ou limite de lancement, 10 tentatives/minute/IP, avec `Retry-After`.

Un lancement réussi rend le salon `IN_GAME`, empêche les entrées et départs et le retire de la liste publique des salons en attente. Le serveur verrouille la même ligne Lobby avec SELECT FOR UPDATE que pour les adhésions. La partie, ses participants, les rôles, la nuit initiale et l'état du salon sont enregistrés dans une seule transaction. Un échec de persistance n'en laisse pas une partie partiellement créée.

Deux lancements concurrents produisent une seule partie. Un lancement simultané à une entrée ou un départ utilise le groupe cohérent obtenu sous ce verrou, jamais un mélange de deux états. Après une réponse réseau incertaine, relire le salon pour récupérer `gameId` ; ne pas supposer qu'une nouvelle tentative créera une autre partie.

## Persistance

La migration `20261119000300_create_game_start` ajoute Role, Game, GameParticipant et GamePhase. Le catalogue des trois rôles et de leurs camps est initialisé par migration. Unicité de la partie par salon, unicité utilisateur/partie et index partiel d'une seule phase non résolue protègent les invariants. Cet index partiel doit être conservé dans les futures migrations, comme celui des adhésions actives.

Les rôles exclusifs restent à définir : leur présence ne peut pas être introduite uniquement par un corps de requête. Ajouter un rôle nécessitera des décisions métier, des adaptations du catalogue et du domaine, puis des tests.

## Test manuel

Dans Swagger, connecter six comptes dans des profils/navigateurs distincts, créer un salon et les y inscrire. Depuis le propriétaire, appeler le POST de lancement, puis depuis chaque compte lire `/participants/me`. Comparer avec l'état collectif, qui ne contient aucun rôle. Vérifier qu'un second lancement et un départ après lancement sont refusés. Les jeux de données synthétiques des tests automatisés sont réservés aux projets Docker isolés et ne doivent pas être injectés sur une base d'utilisateurs réels.
