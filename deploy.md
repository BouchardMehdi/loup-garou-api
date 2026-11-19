# Déploiement sur le VPS Linux de l’école

Ce guide concerne le socle API. Il ne déploie pas les fonctionnalités de jeu encore absentes et n'effectue aucune action sur le VPS à lui seul.

## Infrastructure retenue

Le VPS décrit ici est celui de l'école, confirmé par le propriétaire le 19 novembre 2026. Nginx et Certbot sont installés sur ce VPS. Docker Compose exécute l'API, PostgreSQL et Redis. Le site principal `bouchard-mehdi.fr` reste chez Hostinger.

Exemple à adapter : sous-domaine `loup-garou.bouchard-mehdi.fr` et port API `3009`. Ce sous-domaine n'a pas été créé par le projet. Vérifier que le port est libre ; ne pas modifier les configurations des autres projets.

## 1. DNS et prérequis

Dans Hostinger, créer un enregistrement A pour `loup-garou` vers l'IP réelle du VPS. Les adresses IP données dans les exemples d'infrastructure ne sont pas reprises comme valeurs certaines. Si un enregistrement AAAA existe, il doit aussi pointer vers le bon VPS ou être retiré avant Certbot.

Attendre la propagation et vérifier :

```bash
dig +short loup-garou.bouchard-mehdi.fr
sudo ss -ltnp | grep ':3009 '
docker --version
docker compose version
sudo nginx -t
```

L'absence de résultat pour la commande du port indique qu'aucun service TCP ne l'écoute. HTTP/HTTPS (80/443) doivent être accessibles pour Nginx et Certbot. Aucun port applicatif ou de base de données ne doit être ouvert publiquement.

## 2. Cloner et configurer

Avec un utilisateur disposant des droits sur `/home/projects` et d'accès à Docker :

```bash
cd /home/projects
git clone https://github.com/BouchardMehdi/loup-garou-api.git
cd loup-garou-api
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

Le dépôt est public : le clonage HTTPS en lecture ne nécessite pas d'authentification GitHub. Les secrets applicatifs restent dans `.env` non versionné. La visibilité du dépôt ne détermine pas celle des packages GHCR ; vérifier séparément les droits de lecture d'une image privée. Ne jamais placer un token dans une URL ou dans le README.

Modifier `.env` avec un éditeur et renseigner :

- `POSTGRES_PASSWORD` : un secret généré, au moins 16 caractères.
- `SESSION_SECRET` : un autre secret aléatoire généré avec `openssl rand -hex 32`, au moins 32 caractères. Ne jamais réutiliser le mot de passe PostgreSQL.
- `SESSION_TTL_SECONDS=28800` et `SESSION_SAME_SITE=lax` : expiration absolue et politique du cookie ; voir le [contrat des comptes](docs/authentication.md).
- `APP_ORIGIN=https://loup-garou.bouchard-mehdi.fr` : origine autorisée du client ; adapter si une interface distincte est ajoutée.
- `API_HOST_PORT=3009` : port libre choisi pour ce projet.
- `NODE_ENV=production`, `TRUST_PROXY_HOPS=1` et un `COMPOSE_PROJECT_NAME` unique et stable.

Conserver `POSTGRES_HOST=db`, `POSTGRES_PORT=5432` et `REDIS_URL=redis://redis:6379` pour Docker. Les identifiants ne sont pas des secrets par défaut et doivent être fournis par l'exploitant. Les sessions utilisent Redis et SESSION_SECRET ; aucun JWT_SECRET n’est utilisé.

## 3. Construire et lancer

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 api
curl --fail http://127.0.0.1:3009/api/health
curl --fail http://127.0.0.1:3009/api/ready
```

Compose attend les contrôles de santé des bases, applique les migrations versionnées via le service `migrate`, puis démarre l’API uniquement si la migration réussit. Aucun port PostgreSQL ou Redis n'est publié ; ne pas utiliser `docker-compose.dev.yml` sur le VPS. Les données sont conservées dans les volumes nommés propres au projet.

`health` vérifie HTTP ; `ready` vérifie les deux dépendances. Docker marque le conteneur unhealthy en cas de panne mais ne le redémarre pas automatiquement pour ce seul motif ; prévoir une supervision externe. `restart: unless-stopped` couvre l'arrêt du processus et les redémarrages du VPS.

## 4. Configurer Nginx

Adapter `server_name` et les deux occurrences du port dans `deploy/nginx/loup-garou-api.conf` si nécessaire. Copier ensuite le fichier :

```bash
sudo cp deploy/nginx/loup-garou-api.conf /etc/nginx/sites-available/loup-garou-api
sudo ln -s /etc/nginx/sites-available/loup-garou-api /etc/nginx/sites-enabled/loup-garou-api
sudo nginx -t
sudo systemctl reload nginx
```

Créer le lien seulement s'il n'existe pas déjà. La configuration préserve `/api/` et `/socket.io/`, transmet les informations du proxy et permet l'upgrade WebSocket. Le timeout Socket.IO est supérieur aux délais de ping.

```bash
curl --fail http://loup-garou.bouchard-mehdi.fr/api/health
```

Le chemin `/` renvoie volontairement 404 pour une API seule ; Swagger est actuellement accessible sur `/api/docs/`. La route `/doc` requise en développement et la configuration HTTP/2 restent à mettre en place dans un futur lot ; voir le [suivi des exigences](docs/requirements.md).

## 5. Activer HTTPS

Après résolution DNS correcte :

```bash
sudo certbot --nginx -d loup-garou.bouchard-mehdi.fr
```

Choisir la redirection HTTP vers HTTPS si l'assistant la propose. Vérifier ensuite :

```bash
sudo nginx -t
curl --fail https://loup-garou.bouchard-mehdi.fr/api/ready
sudo certbot renew --dry-run
```

Le renouvellement doit être planifié par le mécanisme fourni à l'installation de Certbot. Ne pas recopier le modèle HTTP du dépôt sur une configuration modifiée par Certbot sans conserver les directives TLS.

Vérifier le transport Socket.IO, même si les connexions applicatives sont actuellement refusées :

```bash
curl --fail 'https://loup-garou.bouchard-mehdi.fr/socket.io/?EIO=4&transport=polling'
```

Une ouverture de transport ne signifie pas qu'un utilisateur est authentifié ; le namespace refuse actuellement toutes les connexions. Les tests du dépôt vérifient ce refus.

## 6. Mettre à jour

Après intégration du travail dans `main` :

```bash
cd /home/projects/loup-garou-api
git pull --ff-only
docker compose up -d --build
docker compose ps
docker compose logs --tail=50 api
curl --fail http://127.0.0.1:3009/api/ready
```

Ne pas exécuter `docker compose down` pour une mise à jour habituelle. Ne pas supprimer les volumes. Une seule instance est prévue à ce stade : une recréation peut interrompre brièvement le service et les connexions temps réel. Le déploiement sans interruption et le load balancing restent à développer pour le cours.

### Migrations de base de données

La migration initiale crée les comptes utilisateurs. `docker compose up -d --build` reconstruit l’API et l’outil de migration ; le service ponctuel `migrate` exécute `prisma migrate deploy` avant le démarrage de l’API. Une base neuve est initialisée et une base déjà à jour ne rejoue pas les migrations appliquées.

Sauvegarder avant toute évolution de schéma. Pour une livraison nécessitant un contrôle séparé :

```bash
docker compose build api migrate
docker compose run --rm migrate
# Seulement après succès :
docker compose up -d --no-build
```

Ne jamais utiliser `migrate dev` ni `db push` en production. Si une migration échoue, arrêter la procédure et examiner l'état avant de remplacer l'API. Prévoir des migrations compatibles avec l'ancienne version pendant le déploiement. La migration ne réinitialise pas les volumes.


## 7. Sauvegardes et retour arrière

Sauvegarder la base avant toute évolution de schéma et régulièrement :

```bash
mkdir -p backups
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "backups/database-$(date +%Y%m%d-%H%M%S).dump"
```

Contrôler que la commande réussit et que l'archive est lisible, conserver des copies hors VPS et tester une restauration dans une base isolée. Ces archives contiennent des données privées ; `backups/` est ignoré par Git. Les fichiers `.env` et la configuration Nginx effective doivent aussi être sauvegardés en lieu sûr.

Ne pas changer simplement POSTGRES_PASSWORD dans `.env` après initialisation : la variable d'image ne modifie pas le mot de passe du compte existant. Organiser sa rotation dans PostgreSQL et l'application.

Pour revenir à une version précédente, utiliser une référence Git de livraison connue puis reconstruire. Une ancienne image ne rétablit pas automatiquement un ancien schéma de base ; vérifier sa compatibilité, sans restauration destructive improvisée.

## 8. Images versionnées et prochaines étapes

Le workflow `image.yml` teste puis publie une image `ghcr.io/bouchardmehdi/loup-garou-api:vX.Y.Z` quand un tag correspondant est poussé. Le Compose actuel construit localement ; le déploiement depuis GHCR reste une évolution et nécessite un accès de lecture au registre pour une image privée.

Les cookies sont Secure en production : le front doit appeler l’API en HTTPS et utiliser `credentials: include`. Nginx transmet déjà `X-Forwarded-Proto` ; `TRUST_PROXY_HOPS=1` correspond à cet unique proxy. Ne pas activer le mode développement sur le VPS pour contourner un problème de cookie.

Aucun déploiement automatique, secret VPS, utilisateur distant ni connexion SSH n'est configuré par ces fichiers. OpenTelemetry/Jaeger et la supervision distante restent à intégrer.
