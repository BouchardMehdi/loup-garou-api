# Loup-Garou API

Back-end multijoueur r?alis? en bin?me pour un cours de d?veloppement d'API. Nom provisoire.

## ?tat du projet

Le socle technique est ex?cutable : Express, Socket.IO, validation de configuration, logs JSON, documentation OpenAPI, routes de sant?, tests et Docker.
Les comptes, salons, r?les, votes, chats et statistiques ne sont pas encore impl?ment?s. Les connexions Socket.IO sont volontairement refus?es jusqu'? l'ajout des sessions et autorisations.

## Stack

TypeScript, Node.js 24 LTS, Express.js 5, PostgreSQL 16, Prisma 7, Redis 7 et Socket.IO 4.
Zod valide les entr?es ; Vitest et Supertest v?rifient le socle.

Pour la suite : sessions Redis avec cookie HttpOnly, Argon2id, cache, instrumentation OpenTelemetry/Jaeger et r?partition de charge entre plusieurs instances. Voir [l'architecture](docs/architecture.md).

## Structure

```text
.
??? back/
?   ??? src/
?   ?   ??? config/
?   ?   ??? http/
?   ?   ??? infrastructure/
?   ?   ??? modules/{accounts,lobbies,game,chat,statistics}/
?   ?   ??? realtime/
?   ?   ??? app.ts
?   ?   ??? server.ts
?   ??? prisma/
?   ??? tests/
?   ??? Dockerfile
?   ??? package-lock.json
??? front/                  # emplacement r?serv?, aucune interface impl?ment?e
??? deploy/nginx/
??? docs/
??? load/
??? .github/workflows/
??? docker-compose.yml
??? docker-compose.dev.yml
??? .env.example
??? deploy.md
??? AGENTS.md
??? CLAUDE.md
```

## Lancement avec Docker

Pr?requis : Git, Docker et Docker Compose v2 ou sup?rieur, moteur Docker d?marr?.

```bash
cp .env.example .env
# Renseigner POSTGRES_PASSWORD (16 caract?res minimum), APP_ORIGIN et un port libre.
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:3009/api/health
curl http://127.0.0.1:3009/api/ready
```

Sous PowerShell, copier avec `Copy-Item .env.example .env`. Les exemples utilisent le port 3009 ; l'adapter si `API_HOST_PORT` change.

Pour un essai local, utiliser `APP_ORIGIN=http://localhost:3009`. En production, utiliser l'origine HTTPS de l'interface autoris?e.
L'API est publi?e uniquement sur `127.0.0.1`. PostgreSQL et Redis n'ont aucun port publi? avec le Compose de production.

- `GET /api/health` : vivacit? du processus HTTP, format HAL.
- `GET /api/ready` : disponibilit? PostgreSQL/Redis ; renvoie 503 si une d?pendance ?choue.
- `/api/docs/` : Swagger UI.
- `/api/openapi.json` : contrat OpenAPI.
- `/socket.io/` : transport Socket.IO r?serv?, sans ?v?nements m?tier ni connexions authentifi?es ? ce stade.

## D?veloppement sans reconstruire l'image

Installer Node.js 24 (voir `back/.nvmrc`). Apr?s cr?ation de `.env`, d?marrer seulement les d?pendances :

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db redis
cd back
npm ci
```

Pour le serveur lanc? sur l'h?te, modifier dans `.env` :

```dotenv
NODE_ENV=development
APP_ORIGIN=http://localhost:3009
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5439
REDIS_URL=redis://127.0.0.1:6389
TRUST_PROXY_HOPS=0
PORT=3009
```

Les ports doivent correspondre ? `DEV_DB_PORT` et `DEV_REDIS_PORT`. Compose continue ? fournir ses propres h?tes internes ? l'API conteneuris?e.

```bash
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run prisma:validate
```

`npm start` ex?cute le code compil? et attend les variables dans l'environnement. Pour charger le fichier racine lors d'un essai local : `node --env-file=../.env dist/server.js` depuis `back/`.

## Prisma

Le sch?ma est pr?par? sans mod?les m?tier ni migration. Aucun client n'est encore g?n?r? ; la readiness utilise une requ?te SQL minimale.
Apr?s validation du mod?le de donn?es : ajouter les mod?les, lancer `npm run prisma:generate`, puis `npm run db:migrate:dev -- --name initial` sur la base de d?veloppement.
Int?grer alors la g?n?ration du client au build et son initialisation aux repositories. Versionner les migrations, jamais le client g?n?r?. En production, utiliser uniquement les migrations d?j? versionn?es ; voir `deploy.md`.

## Fonctionnalit?s pr?vues

- Inscription, connexion et d?connexion.
- Salons publics et priv?s par code ; lancement par le cr?ateur.
- Attribution al?atoire confidentielle des r?les : villageois, loup-garou et voyante.
- Alternance jour/nuit, actions nocturnes, votes, ?liminations et victoire automatique.
- Historique, statistiques et trois canaux de chat en temps r?el par partie.
- R?les exclusifs invent?s ult?rieurement ; pouvoirs ? d?finir.

| Joueur | Chat public de la partie | Chat des loups-garous | Chat des morts |
| --- | --- | --- | --- |
| Villageois vivant | Oui | Non | Non |
| Voyante vivante | Oui | Non | Non |
| Loup-garou vivant | Oui | Oui | Non |
| Mort, quel que soit son r?le | Non | Non | Oui |

Ces acc?s s'appliquent ? tout moment, ind?pendamment du jour et de la nuit, ? la lecture, ? l'envoi et ? la r?ception. Un mort perd l'acc?s aux canaux des vivants.

## Travail en bin?me et automatisation

Les consignes Codex/Claude sont dans `AGENTS.md` et `CLAUDE.md`, dont les contenus doivent rester identiques.
Travailler par branches et pull requests. La CI v?rifie types, lint, tests, build, sch?ma Prisma, ?galit? des consignes, configuration Compose, construction de l'image et d?marrage avec PostgreSQL/Redis.
Un tag `v*` d?clenche ?galement les v?rifications puis publie une image versionn?e dans GHCR. Aucun acc?s au VPS ni d?ploiement distant automatique n'est configur?.

Un premier sc?nario de charge HTTP est dans `load/health.js` : `k6 run load/health.js` contre une instance de test locale. Il ne couvre pas encore Socket.IO.

Le [guide VPS](deploy.md) d?taille DNS Hostinger, Nginx, Certbot, mises ? jour et sauvegardes.
