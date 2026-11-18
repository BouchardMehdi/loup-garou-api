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
- Le dépôt contient actuellement le cadrage ; aucun serveur, script de lancement ou environnement applicatif n'est encore implémenté.
- La stack ci-dessous est validée. Les commandes et versions exactes seront documentées une fois l'environnement créé.
- Ne pas démarrer une nouvelle étape de développement sur la seule base de ce document : respecter la demande en cours.
- Communiquer et écrire la documentation en français. Utiliser l'anglais pour les identifiants de code et des noms cohérents dans l'API.

## Fonctionnalités validées

- Comptes utilisateurs : inscription, connexion et déconnexion.
- Salons publics listés et salons privés accessibles par code.
- Lancement par le créateur du salon et attribution aléatoire, confidentielle des rôles.
- Trois rôles de départ : villageois, loup-garou et voyante.
- Alternance jour/nuit, actions nocturnes, votes, éliminations et détection de victoire.
- Historique des parties et statistiques simples.
- Trois chats distincts par partie, en temps réel.
- Prévoir l'ajout ultérieur de rôles inventés et exclusifs ; leurs pouvoirs et règles restent à définir avec les développeurs.

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
- Ne pas déduire de nouvelles règles pour l'avant-partie, les spectateurs ou l'après-partie : ces cas restent à définir.

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

## Décisions encore ouvertes

- Nombre de joueurs, répartition des rôles et conditions exactes de victoire.
- Égalités, abstentions, délais, déconnexions et abandon d'une partie.
- Pouvoirs, camps, conditions de victoire et accès aux chats des rôles exclusifs.
- Sélection des rôles activés par le créateur du salon : proposition à valider.
- Accès aux messages avant/après la partie, spectateurs et durée de conservation.
- Modèle de données, contrat précis des routes et événements, statistiques conservées.
- Hébergement, gestion des migrations au déploiement et durée des sessions.

Ne pas présenter ces points comme déjà décidés. Demander une précision lorsqu'une décision conditionne le comportement à implémenter ; poursuivre les travaux indépendants utiles.

## Commentaires de suivi et évolutions futures

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
