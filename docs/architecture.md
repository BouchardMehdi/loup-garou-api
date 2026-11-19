# Architecture de la solution

## Contexte système C4 — niveau 1

Le système étudié est la plateforme Loup-Garou API, incluant sa future interface de démonstration. Les comptes sont internes : aucun fournisseur externe d'identité n'est utilisé. PostgreSQL, Redis, Nginx et le moteur de jeu appartiennent à la réalisation interne et ne sont pas des systèmes externes dans cette vue.

```mermaid
flowchart LR
    Player["Personne : joueur"]
    Maintainer["Personne : développeur / exploitant du binôme"]
    Platform["Système : plateforme Loup-Garou API<br/>Salons, parties, rôles secrets et chats"]
    Forge["Système externe : GitHub et GHCR<br/>Sources, CI et images versionnées"]
    Player -->|"Jouer et échanger via le navigateur en HTTPS"| Platform
    Platform -->|"État autorisé, messages et résultat"| Player
    Maintainer -->|"Configurer, livrer et diagnostiquer sur le VPS de l'école"| Platform
    Maintainer -->|"Commits, PR et versions"| Forge
    Forge -->|"Sources et images pour livraison par l'exploitant"| Platform
```

La frontière du produit est le nœud plateforme ; GitHub/GHCR fournit les artefacts de développement et de livraison. Cette relation ne signifie pas qu'un déploiement automatique sur le VPS existe déjà. Hostinger fournit le DNS des sous-domaines ; le site principal reste chez Hostinger et ne participe pas aux parties.

Le diagramme représente le contexte cible, pas la disponibilité actuelle des fonctionnalités. Les rôles d'exploitant et de joueur sont distincts : exploiter la machine n'accorde pas de pouvoir d'arbitrage dans l'application.

## Vue technique du déploiement initial

```mermaid
flowchart LR
    Browser[Client navigateur] -->|HTTPS /api et /socket.io| Nginx[Nginx du VPS + Certbot]
    Nginx -->|localhost:3009| API[Docker : Express + Socket.IO]
    API --> PG[(PostgreSQL)]
    API --> Redis[(Redis)]
```

La cible est le VPS de l'école, confirmé par le propriétaire. Le port hôte est configurable. PostgreSQL et Redis sont sur un réseau Docker interne, sans ports publiés dans la configuration de production.

## Organisation du back-end

- `src/app.ts` : application HTTP sans ouverture de port, testable avec Supertest.
- `src/server.ts` : démarrage, connexions aux dépendances et arrêt gracieux.
- `src/config/` : validation de configuration et construction des URL sans journaliser les secrets.
- `src/http/` : contrat OpenAPI initial.
- `src/infrastructure/` : connexions PostgreSQL/Redis, actuellement utilisées pour la readiness.
- `src/realtime/` : serveur Socket.IO ; connexions refusées tant que l'authentification n'est pas implémentée.
- `src/modules/` : comptes, salons, moteur de jeu, chat et statistiques, encore non implémentés.
- `prisma/` : modèle User et première migration ; le repository des comptes utilise Prisma. Les modèles de jeu restent à ajouter.

## Étapes suivantes

Documents de conception : [spécifications](specifications.md), [MCD](data-model.md), [contrats préliminaires](interfaces.md) et [suivi des exigences](requirements.md).

Les comptes sont livrés avec sessions Redis, Argon2id, protection CSRF et limitation des requêtes : voir le [contrat pour le front](authentication.md). Le front est réalisé séparément par le collègue ; aucune application front n’est ajoutée ici. Les règles et canaux du jeu restent à développer, et Socket.IO reste fermé aux connexions applicatives.

L'instrumentation OpenTelemetry/Jaeger, l'adaptateur Redis Socket.IO et le déploiement de plusieurs instances restent à implémenter. La configuration actuelle lance une seule instance : Nginx agit comme reverse proxy, sans répartition effective entre plusieurs serveurs. Le load balancing demandé dans le cours nécessitera une étape dédiée.

Les tests unitaires vérifient le socle et les comptes sans base réelle. Deux tests d’intégration dans le profil Docker `test` vérifient les repositories, les sessions et le compteur Redis. Le smoke test HTTP de la CI exerce le parcours complet dans le conteneur API. Les modules de jeu nécessiteront leurs propres tests.

## Audit initial des dépendances

Au 18 novembre 2026, `npm audit` signale une vulnérabilité ReDoS de `picomatch` (GHSA-fc5q-39xc-vjpf), propagée par les outils de développement Vitest/Vite et typescript-eslint. Le registre consulté ne propose pas de version corrigée : la dernière version publiée est 4.0.7, incluse dans la plage affectée. Ne pas appliquer de rétrogradation automatique forcée ; suivre la publication du correctif et relancer les tests après mise à jour.

Ces dépendances ne sont pas installées dans l'image runtime (`npm ci --omit=dev`). L'audit de production doit être vérifié séparément avec `npm audit --omit=dev`. Ne pas exposer de serveur de tests ou d'outillage de développement sur le VPS.

## Vérifications du socle en local

Types, lint, huit tests, compilation et validation Prisma vérifiés. Les configurations Compose de production et de développement sont valides. L'audit des dépendances de production ne signale aucune vulnérabilité au 18 novembre 2026.

La construction et le démarrage Docker n'ont pas pu être vérifiés sur la machine de préparation : le moteur Docker Desktop Linux était arrêté. Le workflow CI contient ces vérifications ; leur résultat ne sera connu qu'après son exécution sur GitHub.

## Séparation du domaine prévue

Les modules métier contiendront des règles et cas d'usage indépendants d'Express, Socket.IO et Prisma. Les adaptateurs HTTP et temps réel appelleront ces cas d'usage avec une identité déjà vérifiée, et les repositories implémenteront les ports de persistance. Le domaine des futurs modules de jeu décidera de l’action permise et de la projection destinée à chaque joueur ; les transports ne recalculent pas les règles.

Les chronomètres serveur déclencheront les mêmes cas d'usage de résolution que la fin anticipée. État de phase et décisions seront persistés pour une résolution unique et une reprise après incident. Le module comptes sépare déjà ports et service des adaptateurs Express/Prisma ; la reprise des phases reste une cible à implémenter.

## Vérification du lot comptes — 19 novembre 2026

- 19 tests unitaires réussis, incluant Argon2id, CSRF, cookies Secure, expiration absolue, rotation et déconnexion.
- Deux tests d'intégration réussis depuis un conteneur de test contre PostgreSQL 16 et Redis 7 réels.
- Images runtime, migration et test construites ; API healthy après application de la migration ; smoke test HTTP complet réussi.
- Réexécution de `migrate deploy` sans migration en attente, puis suppression des seuls conteneurs/volumes éphémères de vérification.
- Types, lint, compilation et audit npm vérifiés ; aucune vulnérabilité signalée par l'audit actuel, contrairement au constat historique du 18 novembre ci-dessus.

Le premier essai des tests d'intégration depuis Windows n'a pas pu joindre les bases publiées sur des ports temporaires ; la vérification réussie et reproductible est désormais exécutée sur le réseau Docker. Le fichier Compose de développement permet aussi l'accès local aux bases avec un réseau non interne, tout en gardant les ports liés à localhost. Cette exception ne s'applique pas à la production.

Aucune vérification de production distante ni résultat de CI GitHub n'est déduit de ces tests locaux.
