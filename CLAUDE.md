# Consignes communes aux agents — Loup-Garou API

Ce document s'adresse à Codex et à Claude Code. Le projet est réalisé en binôme pour un cours de développement back-end. Les développeurs doivent comprendre le code et pouvoir justifier les choix à l'oral.

## Synchronisation obligatoire

- `AGENTS.md` et `CLAUDE.md` doivent toujours avoir un contenu strictement identique.
- Toute modification de l'un doit être reproduite dans l'autre, y compris les commentaires, dans le même commit.
- Lire les deux fichiers avant de travailler. En cas de divergence, examiner le diff et l'historique ; ne pas écraser silencieusement les changements du collègue.
- Documenter les décisions validées dans les sections correspondantes. Inscrire les idées et évolutions non validées dans les commentaires HTML de la section finale, avec date, statut et contexte.
- Un commentaire d'évolution est une note de suivi, pas une autorisation d'implémenter une fonctionnalité.
- À chaque modification de ces consignes, vérifier l'égalité exacte des deux fichiers.

## État et périmètre

- Nom provisoire : Loup-Garou API. Dépôt GitHub : `BouchardMehdi/loup-garou-api`.
- Le socle Express/TypeScript, routes de santé, Socket.IO, tests et Docker est présent. Les fonctionnalités métier restent à implémenter.
- La stack ci-dessous est validée. Consulter back/package.json, le README et deploy.md pour les versions, commandes et procédures disponibles.
- Ne pas démarrer une nouvelle étape de développement sur la seule base de ce document : respecter la demande en cours.
- Communiquer et écrire la documentation en français. Utiliser l'anglais pour les identifiants de code et des noms cohérents dans l'API.

## Fonctionnalités validées

- Comptes utilisateurs : inscription, connexion et déconnexion.
- Salons publics listés et salons privés accessibles par code.
- Lancement par le créateur du salon et attribution aléatoire, confidentielle des rôles.
- Trois rôles de départ : villageois, loup-garou et voyante.
- Alternance jour/nuit, actions nocturnes, votes, éliminations et détection de victoire.
- Historique des parties et statistiques simples.
- Trois chats distincts pendant la partie, en temps réel, puis un canal commun d’après-partie.
- Prévoir l'ajout ultérieur de rôles inventés et exclusifs ; leurs pouvoirs et règles restent à définir avec les développeurs.

## Règles de la première version

- Source de vérité fonctionnelle : `docs/specifications.md` ; MCD : `docs/data-model.md` ; interfaces futures : `docs/interfaces.md` ; conformité : `docs/requirements.md`.
- Ces documents décrivent une cible, pas des fonctionnalités déjà disponibles. Le schéma Prisma et le code applicatif ne sont pas modifiés par la branche de conception.
- 6 à 12 joueurs ; une voyante, un loup pour 6–7 joueurs, deux pour 8–10 et trois pour 11–12, autres joueurs villageois.
- Victoire du village sans loup vivant ; victoire des loups à parité ou majorité des vivants. Les morts partagent le résultat de leur camp.
- Départ de nuit, puis débat et vote. Durées entières réglables de 30 à 300 secondes ; valeurs initiales débat/vote/nuit : 180/60/60.
- Nuit et vote se terminent dès validation de tous les acteurs attendus, ou à l'échéance ; le débat garde sa durée. Choix définitifs, abstention possible, action manquante sans effet.
- Vote du village et choix des loups : maximum unique uniquement ; égalité ou absence de voix = aucune victime. Pas de cible soi-même, pas de cible loup pour les loups.
- La voyante peut découvrir le rôle exact d'un autre vivant, uniquement pour elle. Les éliminations ne révèlent pas les rôles au village avant la fin.
- Les déconnexions ne suppriment pas la participation ni n'arrêtent les délais ; restaurer l'état autorisé à la reconnexion.
- Une partie par salon en V1 ; aucun nouveau participant ni réglage après lancement. Les conventions complémentaires et scénarios d'acceptation sont dans les spécifications.

## Règles impératives des chats

Les accès sont indépendants de la phase jour/nuit. Le chat public est commun aux participants de la partie, même pour un salon privé.

| État et rôle | Public | Loups-garous | Morts |
| --- | --- | --- | --- |
| Villageois vivant | Oui | Non | Non |
| Voyante vivante | Oui | Non | Non |
| Loup-garou vivant | Oui | Oui | Non |
| Mort, quel que soit son rôle | Non | Non | Oui |

- Appliquer ces règles à la lecture de l'historique, à l'envoi et à la réception en temps réel.
- Vérifier l'identité, l'appartenance à la partie, l'état et le rôle côté serveur. Le client ne choisit jamais librement ses rooms.
- À l'élimination, retirer toutes les connexions du joueur des canaux des vivants et autoriser uniquement celui des morts.
- Réévaluer les accès après reconnexion ; une ancienne connexion ou session ne doit pas conserver des droits périmés.
- Avant-partie : aucun chat prévu en V1 ; spectateurs exclus. Après-partie : révéler les rôles aux seuls participants et ouvrir POST_GAME à tous ces participants. Les trois anciens canaux deviennent des historiques en lecture seule, accessibles selon le rôle et l’état final du joueur ; un mort ne retrouve pas les canaux des vivants.

## Stack validée

| Usage | Technologie |
| --- | --- |
| Langage et serveur | TypeScript, Node.js LTS, Express.js |
| Données et ORM | PostgreSQL, Prisma, migrations versionnées |
| Temps réel | Socket.IO |
| Validation des entrées | Zod pour HTTP et les événements Socket.IO |
| Authentification | Sessions serveur dans Redis, cookie HttpOnly, hachage Argon2id |
| Cache | Redis, notamment pour les statistiques publiques |
| API et documentation | REST avec HAL, OpenAPI et Swagger UI |
| Tests | Vitest, Supertest, client Socket.IO pour les tests temps réel |
| Charge | k6 pour HTTP ; stratégie de charge Socket.IO à définir |
| Conteneurs | Docker et Docker Compose |
| CI/CD et images | GitHub Actions et GitHub Container Registry |
| Répartition de charge | Nginx |
| Observabilité | OpenTelemetry, Jaeger et logs structurés |

- Redis sert aussi à l'adaptateur Socket.IO lorsque plusieurs instances sont déployées. Configurer l'affinité des sessions si le transport long-polling est conservé.
- PostgreSQL conserve les données durables, dont les messages. Ne pas utiliser la mémoire d'une instance comme seule source de vérité des parties en déploiement multiple.
- Fixer des versions compatibles à l'initialisation et committer le fichier de verrouillage des dépendances.

## Architecture et fiabilité

- Une seule application back-end modulaire : comptes, salons, moteur de jeu, chat et historique/statistiques.
- Séparer les routes HTTP, les événements Socket.IO, les règles métier et l'accès aux données. HTTP et Socket.IO réutilisent les mêmes règles d'autorisation.
- Le serveur est l'arbitre : il calcule rôles, phases, actions valides, éliminations et victoire.
- Préserver la cohérence lors de requêtes simultanées et de doublons : transactions, contraintes et contrôle des transitions à prévoir.
- Protéger les informations secrètes dans les réponses, événements, caches, traces et logs. Chaque destinataire reçoit uniquement les informations autorisées.
- Conserver le moteur de jeu testable indépendamment du réseau et extensible pour les futurs rôles, sans construire un système de plugins prématuré.

## Sécurité et vérification

- Ne jamais committer de secrets, de mots de passe ni de fichiers `.env`. Fournir uniquement un `.env.example` sans valeurs sensibles lorsque nécessaire.
- Valider les entrées, limiter les requêtes et messages, configurer les origines autorisées et protéger les requêtes authentifiées par cookie contre les attaques CSRF.
- Vérifier les autorisations côté serveur pour chaque action sensible, y compris les actions en temps réel.
- Tester les règles métier modifiées : accès aux chats, confidentialité des rôles, votes, éliminations, transitions, victoire et concurrence selon la portée du changement.
- Exécuter les vérifications pertinentes disponibles : types, lint et tests. Ne pas annoncer un test réussi s'il n'a pas été exécuté ; indiquer ce qui manque.
- Garder OpenAPI, les schémas d'architecture et les instructions de lancement cohérents avec l'implémentation.

## Travail en binôme et Git

- Examiner le statut Git et les instructions du dépôt avant toute modification.
- Ne pas écraser, supprimer ou réinitialiser le travail du collègue ou de l'utilisateur.
- Pour les développements, utiliser des branches courtes `feat/...`, `fix/...` ou `docs/...` et des pull requests vers `main`. Pas de push forcé ni de réécriture d'historique sans demande explicite.
- Faire des commits ciblés avec des messages explicites, par exemple `feat: add private lobby creation`.
- Ne committer que les fichiers de la tâche ; vérifier le diff et l'absence de secrets avant commit.
- La CI doit progressivement vérifier le code et les tests avant construction et publication des images versionnées.
- Distinguer clairement ce qui est réalisé, testé, prévu ou bloqué dans le compte rendu.

## Structure et déploiement VPS

- `back/` contient le serveur ; `front/` est réservé à une interface future sans framework choisi.
- Depuis `back/` : `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run prisma:validate`.
- Prisma est configuré sans modèles ni client généré. Ajouter génération et repositories avec le modèle de données validé.
- Infrastructure : VPS Linux de l’école, confirmé par l’utilisateur ; Nginx et Certbot sur l’hôte ; API, PostgreSQL et Redis dans Docker Compose. DNS des sous-domaines chez Hostinger ; site principal conservé chez Hostinger.
- Le dépôt GitHub est public, selon confirmation de l’utilisateur le 19 novembre 2026. Ne pas traiter cette visibilité comme une autorisation de publier des secrets ; GHCR possède ses propres droits d’accès.
- Conserver à la racine `docker-compose.yml`, `.env.example`, `README.md` et `deploy.md`, à actualiser avec chaque nouvelle variable ou étape d'exploitation.
- Lancement : `docker compose up -d --build` après configuration de `.env`. Ne pas utiliser le Compose de développement sur le VPS.
- Publier les ports applicatifs uniquement sur `127.0.0.1`, avec un port distinct des autres projets. Aucun port de base de données publié en production.
- Le port 3009 et `loup-garou.bouchard-mehdi.fr` sont des exemples à vérifier, sans port réservé ni DNS créé.
- Nginx transmet `/api/` et `/socket.io/`, avec upgrade WebSocket et en-têtes du proxy. Préserver les modifications TLS de Certbot.
- Conserver les volumes PostgreSQL/Redis. Pour les mises à jour habituelles : `git pull --ff-only` puis `docker compose up -d --build`, sans `docker compose down` ni suppression de volumes.
- Prévoir sauvegarde et migration contrôlée lors des futures évolutions de schéma. Les secrets restent hors Git.
- Le socle n'est pas jouable : comptes, sessions, règles du jeu et chats restent à développer. OpenTelemetry/Jaeger, plusieurs instances et déploiement sans interruption restent à intégrer.
- Aucun déploiement distant autorisé par ces seules consignes : suivre la demande de l'utilisateur.

## Décisions encore ouvertes

- Pouvoirs, camps, interactions et droits des futurs rôles exclusifs ; sélection des rôles par salon au-delà de la composition V1.
- Politique de conservation et de suppression de compte avant utilisation de données réelles.
- Schémas détaillés des entrées HTTP/Socket.IO, validation des comptes et messages, durée et cycle des sessions : à figer dans les lots concernés.
- Traduction du MCD en schéma Prisma, index, transactions et politique de migrations compatibles.
- Revanche dans le même salon, spectateurs, modération et abandon explicite : hors V1, ne pas les ajouter implicitement.

Ne pas présenter ces points comme déjà décidés. Demander une précision lorsqu'une décision conditionne le comportement à implémenter ; poursuivre les travaux indépendants utiles.

## Commentaires de suivi et évolutions futures

<!--
2026-11-19 | VALIDÉ ET DOCUMENTÉ | Conception de la première version
Décisions de jeu recueillies auprès de l’utilisateur : 6–12 joueurs, composition, parité, délais réglables, égalités sans victime, reconnexion et canal d’après-partie. Spécifications, MCD, contexte C4, contrats préliminaires et matrice des exigences ajoutés. VPS confirmé comme celui de l’école et dépôt rendu public par l’utilisateur. Aucun code métier ni migration livré par cette branche.
-->


<!--
2026-11-18 | IMPLÉMENTÉ | Socle et cible VPS
Structure back-end, Docker Compose, modèle Nginx avec Socket.IO, CI et guide VPS créés. Infrastructure validée par l'utilisateur. Aucun déploiement distant effectué. Construction Docker locale à vérifier lorsque le moteur sera démarré.
-->


<!--
2026-11-18 | VALIDÉ | Socle du projet
Stack et périmètre issus des décisions des développeurs. Trois rôles classiques pour la première version ; extension à des rôles exclusifs prévue, sans pouvoirs encore définis.
-->

<!--
2026-11-18 | À DÉFINIR | Rôles exclusifs
Pour chaque proposition : nom, camp, pouvoir, phase d'action, limites d'utilisation, interactions, conditions de victoire et droits de chat. Attendre validation avant implémentation.
-->

<!--
MODÈLE DE NOTE À COPIER DANS LES DEUX FICHIERS
AAAA-MM-JJ | PROPOSÉ / VALIDÉ / IMPLÉMENTÉ / ABANDONNÉ | Sujet
Contexte, décision ou proposition, impact, référence éventuelle à une issue ou une PR.
Une fois une décision validée, mettre aussi à jour la section concernée ci-dessus.
-->
