# Loup-Garou API

Back-end multijoueur réalisé en binôme pour un cours de développement d'API. Nom provisoire. Dépôt GitHub public ; cible de déploiement : VPS de l'école.

## État du projet

Le socle technique est exécutable : Express, Socket.IO, validation de configuration, logs JSON, documentation OpenAPI, routes de santé, tests et Docker.
Les comptes, salons, rôles, votes, chats et statistiques ne sont pas encore implémentés. Les connexions Socket.IO sont volontairement refusées jusqu'à l'ajout des sessions et autorisations.

## Documents de conception

La première version est spécifiée ; elle n'est pas encore implémentée.

- [Spécifications fonctionnelles et scénarios d'acceptation](docs/specifications.md).
- [Modèle conceptuel de données (MCD)](docs/data-model.md).
- [Architecture : contexte C4 et vue technique](docs/architecture.md).
- [Contrats HTTP et Socket.IO préliminaires](docs/interfaces.md).
- [Suivi des exigences et preuves attendues au rendu](docs/requirements.md).

Règles retenues : 6 à 12 joueurs ; une voyante et 1, 2 ou 3 loups selon l'effectif ; victoire des loups à parité ; égalité sans élimination. Débat, vote et nuit sont réglables entre 30 et 300 secondes (valeurs initiales 180/60/60). Les déconnexions ne suppriment pas les participants. Après la partie, les rôles sont révélés et un canal commun est ouvert.

## Stack

TypeScript, Node.js 24 LTS, Express.js 5, PostgreSQL 16, Prisma 7, Redis 7 et Socket.IO 4.
Zod valide les entrées ; Vitest et Supertest vérifient le socle.

Pour la suite : sessions Redis avec cookie HttpOnly, Argon2id, cache, instrumentation OpenTelemetry/Jaeger et répartition de charge entre plusieurs instances. Voir [l'architecture](docs/architecture.md).

## Structure

```text
project/
|-- back/
|   |-- src/{config,http,infrastructure,modules,realtime}/
|   |-- src/app.ts
|   |-- src/server.ts
|   |-- prisma/
|   |-- tests/
|   |-- Dockerfile
|   `-- package-lock.json
|-- front/                  # réservé à une interface future
|-- deploy/nginx/
|-- docs/
|-- load/
|-- .github/workflows/
|-- docker-compose.yml
|-- docker-compose.dev.yml
|-- .env.example
|-- deploy.md
|-- AGENTS.md
`-- CLAUDE.md
```

## Lancement avec Docker

Prérequis : Git, Docker et Docker Compose v2 ou supérieur, moteur Docker démarré.

```bash
cp .env.example .env
# Renseigner POSTGRES_PASSWORD (16 caractères minimum), APP_ORIGIN et un port libre.
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:3009/api/health
curl http://127.0.0.1:3009/api/ready
```

Sous PowerShell, copier avec `Copy-Item .env.example .env`. Les exemples utilisent le port 3009 ; l'adapter si `API_HOST_PORT` change.

Pour un essai local, utiliser `APP_ORIGIN=http://localhost:3009`. En production, utiliser l'origine HTTPS de l'interface autorisée.
L'API est publiée uniquement sur `127.0.0.1`. PostgreSQL et Redis n'ont aucun port publié avec le Compose de production.

- `GET /api/health` : vivacité du processus HTTP, format HAL.
- `GET /api/ready` : disponibilité PostgreSQL/Redis ; renvoie 503 si une dépendance échoue.
- `/api/docs/` : Swagger UI.
- `/api/openapi.json` : contrat OpenAPI.
- `/socket.io/` : transport Socket.IO réservé, sans événements métier ni connexions authentifiées à ce stade.

## Développement sans reconstruire l'image

Installer Node.js 24 (voir `back/.nvmrc`). Après création de `.env`, démarrer seulement les dépendances :

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db redis
cd back
npm ci
```

Pour le serveur lancé sur l'hôte, modifier dans `.env` :

```dotenv
NODE_ENV=development
APP_ORIGIN=http://localhost:3009
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5439
REDIS_URL=redis://127.0.0.1:6389
TRUST_PROXY_HOPS=0
PORT=3009
```

Les ports doivent correspondre à `DEV_DB_PORT` et `DEV_REDIS_PORT`. Compose continue à fournir ses propres hôtes internes à l'API conteneurisée.

```bash
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run prisma:validate
```

`npm start` exécute le code compilé et attend les variables dans l'environnement. Pour charger le fichier racine lors d'un essai local : `node --env-file=../.env dist/server.js` depuis `back/`.

## Prisma

Le schéma est préparé sans modèles métier ni migration. Aucun client n'est encore généré ; la readiness utilise une requête SQL minimale.
Après validation du modèle de données : ajouter les modèles, lancer `npm run prisma:generate`, puis `npm run db:migrate:dev -- --name initial` sur la base de développement.
Intégrer alors la génération du client au build et son initialisation aux repositories. Versionner les migrations, jamais le client généré. En production, utiliser uniquement les migrations déjà versionnées ; voir `deploy.md`.

## Fonctionnalités prévues

- Inscription, connexion et déconnexion.
- Salons publics et privés par code ; lancement par le créateur.
- Attribution aléatoire confidentielle des rôles : villageois, loup-garou et voyante.
- Alternance jour/nuit, actions nocturnes, votes, éliminations et victoire automatique.
- Historique, statistiques, trois canaux de chat pendant la partie et un canal commun après-partie.
- Rôles exclusifs inventés ultérieurement ; pouvoirs à définir.

| Joueur | Chat public de la partie | Chat des loups-garous | Chat des morts |
| --- | --- | --- | --- |
| Villageois vivant | Oui | Non | Non |
| Voyante vivante | Oui | Non | Non |
| Loup-garou vivant | Oui | Oui | Non |
| Mort, quel que soit son rôle | Non | Non | Oui |

Ces accès s'appliquent pendant la partie à tout moment, indépendamment du jour et de la nuit, à la lecture, à l'envoi et à la réception. Un mort perd l'accès aux canaux des vivants. Après la partie, tous les participants accèdent au canal commun POST_GAME ; les anciens canaux deviennent des historiques en lecture seule selon les droits finaux de chacun.

## Travail en binôme et automatisation

Les consignes Codex/Claude sont dans `AGENTS.md` et `CLAUDE.md`, dont les contenus doivent rester identiques.
Travailler par branches et pull requests. La CI vérifie types, lint, tests, build, schéma Prisma, égalité des consignes, configuration Compose, construction de l'image et démarrage avec PostgreSQL/Redis.
Un tag `v*` déclenche également les vérifications puis publie une image versionnée dans GHCR. Aucun accès au VPS ni déploiement distant automatique n'est configuré.

Un premier scénario de charge HTTP est dans `load/health.js` : `k6 run load/health.js` contre une instance de test locale. Il ne couvre pas encore Socket.IO.

Le [guide VPS](deploy.md) détaille DNS Hostinger, Nginx, Certbot, mises à jour et sauvegardes.
