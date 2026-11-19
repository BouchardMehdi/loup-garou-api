# Contrats d'interface préliminaires

Statut : contrats cibles ; les routes de comptes, sessions et salons sont implémentées. Voir le [guide d’authentification](authentication.md) et le [contrat des salons](lobbies.md). Le [lancement des parties et les lectures de rôles personnels](game-start.md) sont également implémentés ; les [actions, votes et résolutions automatiques](game-engine.md) sont également disponibles ; Socket.IO refuse encore les connexions applicatives. Références : [règles](specifications.md), [MCD](data-model.md).

## 1. Principes communs

Préfixe HTTP métier : `/api`. Authentification par session serveur Redis et cookie HttpOnly ; les routes protégées et Socket.IO partagent la même identité. Les mutations authentifiées par cookie nécessitent une protection CSRF ; aucune identité, camp, état vivant ou attribution de rôle fourni par le client ne fait autorité.

Le domaine ne dépend ni des requêtes Express ni des sockets ni de Prisma. Les adaptateurs appellent les mêmes services d'autorisation et de jeu ; les repositories assurent la persistance. Dates et échéances sont fournies par le serveur en UTC.

Représentations de ressources et collections : `application/hal+json` avec `_links`, et `_embedded` pour les collections. Ne jamais exposer directement les objets ORM. Erreurs JSON sans stack, secret ou détail de connexion : 400 pour une entrée invalide, 401 sans session, 403 sans droit, 404 pour une ressource inexistante ou dont l'existence doit rester privée, 409 pour un état métier incompatible, 429 pour une limite de requêtes dépassée. Une inspection valide de voyante est une exception explicite à la confidentialité du rôle de la cible.

Chaque création HTTP renvoie 201 et un header `Location` ; une suppression de session ou d'appartenance réussie renvoie 204. Les lectures réussies renvoient 200. Les formes détaillées des entrées seront inscrites dans OpenAPI au moment du développement de chaque lot.

## 2. Ressources HTTP — comptes, salons, lancement et actions disponibles ; chat/statistiques à venir

| Méthode et chemin | Responsabilité | Accès et principales données |
| --- | --- | --- |
| `POST /api/users` | Inscrire un utilisateur | Public ; pseudonyme, e-mail, mot de passe ; profil personnel sans empreinte |
| `POST /api/sessions` | Ouvrir une session | Public ; e-mail et mot de passe ; cookie, jamais l'identifiant Redis dans le JSON |
| `DELETE /api/sessions/current` | Se déconnecter | Session courante invalidée côté serveur |
| `GET /api/me` | Consulter son profil | Utilisateur connecté ; e-mail réservé à soi-même |
| `GET /api/lobbies` | Lister les salons publics en attente | Connecté ; collection paginée, effectif et réglages, aucun code privé |
| `POST /api/lobbies` | Créer un salon | Connecté ; nom, visibilité, capacité et durées ; le créateur devient membre |
| `GET /api/lobbies/{lobbyId}` | Consulter un salon | Salon public en attente ou membre autorisé ; projection sans secret |
| `POST /api/lobbies/{lobbyId}/memberships` | Rejoindre un salon | Connecté ; code requis si privé, capacité et état vérifiés |
| `DELETE /api/lobbies/{lobbyId}/memberships/me` | Quitter avant lancement | Membre en attente ; transfert de propriété ou fermeture selon les règles |
| `POST /api/lobbies/{lobbyId}/games` | Lancer la partie | Créateur ; 6 à 12 membres, attribution et création atomiques |
| `GET /api/games/{gameId}` | Lire la projection de la partie | Participant ; phase, échéance, vivants, résultat ; pas de liste de rôles avant la fin |
| `GET /api/games/{gameId}/participants/me` | Consulter son rôle et son état | Soi-même ; coéquipiers loups si applicable, résultat d'inspection personnel |
| `POST /api/games/{gameId}/phases/{phaseId}/night-actions` | Valider son action nocturne | Acteur vivant attendu ; cible ou abstention ; résultat de voyance privé |
| `POST /api/games/{gameId}/phases/{phaseId}/votes` | Valider son bulletin | Votant vivant ; cible ou abstention, un choix définitif |
| `GET /api/games/{gameId}/phases/{phaseId}/night-actions/me` | Relire son action | Participant ; sa propre action uniquement, y compris après résolution |
| `GET /api/games/{gameId}/phases/{phaseId}/votes/me` | Relire son bulletin | Participant ; son propre bulletin uniquement |
| `GET /api/games/{gameId}/channels/{channel}/messages` | Lire un historique de canal | Participant actuellement autorisé ; collection paginée, y compris après-partie |
| `GET /api/me/games` | Lire ses parties terminées | Soi-même ; collection paginée avec résultat personnel |
| `GET /api/statistics/players` | Lire les statistiques publiques | Connecté ; pseudonymes et compteurs, collection paginée et cache Redis |

Une création d'action ou de vote répétée après validation renvoie 409 ; le client lit son état après une erreur réseau au lieu de supposer que la première requête a échoué. Les requêtes inter-parties et les tentatives de changement de rôle sont refusées. Un vote absent de l'API n'est pas un vote pour un joueur déconnecté.

Le code privé initial n'est communiqué qu'au créateur pour invitation ; il n'entre ni dans la liste publique ni dans les logs ou événements communs. Connaître un identifiant de salon privé sans le code ne donne pas accès à son contenu. La modification des réglages après création et la régénération du code sont hors V1 : créer un autre salon si nécessaire.

### Pagination et cache

Conventions de conception : `page` commence à 1, `pageSize` vaut 25 par défaut, entre 1 et 100. Valeurs invalides : 400 ; page valide au-delà du total : collection vide. Les collections fournissent `self`, `first`, `last` et, lorsque pertinentes, `prev` et `next`, ainsi que page, taille et total. Les salons sont triés du plus récent au plus ancien, départagés par identifiant ; les messages et historiques suivent également un tri chronologique stable avec départage par identifiant.

Le cache serveur Redis cible la collection publique de statistiques : clé incluant les paramètres de pagination, durée initiale de 30 secondes et invalidation à la fin d'une partie. Les réponses personnelles et secrètes ne sont pas placées dans un cache partagé. Une panne du cache peut conduire à recalculer la réponse ; elle ne doit pas élargir ses droits d'accès.

## 3. Contrats Socket.IO futurs

Transport existant : `/socket.io/`. L'authentification de session doit être implémentée avant d'accepter des connexions. Les noms ci-dessous constituent le vocabulaire initial cible.

| Sens | Événement | Comportement |
| --- | --- | --- |
| Client → serveur | `lobby:subscribe` | Demander le suivi d’un salon ; vérifier sa visibilité et les droits avant abonnement |
| Client → serveur | `game:subscribe` | Demander le suivi d'une partie ; le serveur vérifie la participation et choisit les rooms permises |
| Client → serveur | `chat:send` | Partie, canal et texte ; vérifier session, état, rôle et appartenance avant stockage puis diffusion |
| Serveur → participants autorisés | `lobby:updated` | Effectif, propriétaire et état publics aux destinataires légitimes |
| Serveur → participants | `game:started` | Identifiant de partie, première phase et échéance, sans rôles secrets |
| Serveur → joueur concerné | `participant:private` | Rôle personnel, coéquipiers autorisés ou résultat privé de voyante |
| Serveur → participants | `phase:changed` | Nouvelle phase et échéance serveur, jamais les actions secrètes |
| Serveur → participants | `participant:eliminated` | Identité du joueur éliminé, sans révélation anticipée du rôle |
| Serveur → canal autorisé | `chat:message` | Message persisté et auteur autorisé ; pas de diffusion globale |
| Serveur → participants | `game:finished` | Camp gagnant, rôles révélés, ouverture du canal d'après-partie |

Les commandes reçoivent un accusé de réception de succès ou une erreur contrôlée ; aucun accusé positif avant validation et persistance. `chat:send` comprend un identifiant de message client, unique par auteur et canal, pour que les réémissions réseau d'un même contenu ne le dupliquent pas ; réutiliser cet identifiant avec un autre contenu est refusé.

Le serveur gère les rooms, par exemple `game:{id}:public`, `game:{id}:wolves`, `game:{id}:dead`, `game:{id}:post-game` et des rooms personnelles. Aucun événement générique permettant de rejoindre une room arbitraire n'est exposé. Le suivi du salon doit vérifier ses propres droits ; une subscription d'une partie ne donne pas accès à d'autres salons.

À l'élimination ou à l'expiration de session, retirer les droits sur toutes les connexions concernées, y compris celles sur d'autres instances lorsque celles-ci seront introduites. Au changement d'état, vérifier les droits avant diffusion et ne pas se fier à une ancienne liste de rooms. Après reconnexion, relire l'état et l'historique autorisés par HTTP ; ne pas supposer que tous les événements ont été reçus.

## 4. Documentation et compatibilité

Le serveur expose `/api/docs/`, `/api/openapi.json` et désormais `/doc` en développement. Le modèle Nginx devra être revu si une nouvelle URL doit traverser le proxy.

Le module comptes ajoute aussi `GET /api/csrf`, `GET /api/users/{userId}` limité à soi-même et `GET /api/sessions/current`. Son guide est la référence pour les validations et statuts effectivement implémentés.

Les schémas HTTP du moteur sont disponibles dans OpenAPI et [game-engine.md](game-engine.md). Les limites des messages et contrats Socket.IO seront figés dans le lot chat ; toute évolution devra être répercutée dans les deux fichiers d'agents et OpenAPI.
