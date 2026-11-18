# D?ploiement sur le VPS Linux

Ce guide concerne le socle API. Il ne d?ploie pas les fonctionnalit?s de jeu encore absentes et n'effectue aucune action sur le VPS ? lui seul.

## Infrastructure retenue

Nginx et Certbot sont install?s sur le VPS. Docker Compose ex?cute l'API, PostgreSQL et Redis. Le site principal `bouchard-mehdi.fr` reste chez Hostinger.

Exemple ? adapter : sous-domaine `loup-garou.bouchard-mehdi.fr` et port API `3009`. Ce sous-domaine n'a pas ?t? cr?? par le projet. V?rifier que le port est libre ; ne pas modifier les configurations des autres projets.

## 1. DNS et pr?requis

Dans Hostinger, cr?er un enregistrement A pour `loup-garou` vers l'IP r?elle du VPS. Les adresses IP donn?es dans les exemples d'infrastructure ne sont pas reprises comme valeurs certaines. Si un enregistrement AAAA existe, il doit aussi pointer vers le bon VPS ou ?tre retir? avant Certbot.

Attendre la propagation et v?rifier :

```bash
dig +short loup-garou.bouchard-mehdi.fr
sudo ss -ltnp | grep ':3009 '
docker --version
docker compose version
sudo nginx -t
```

L'absence de r?sultat pour la commande du port indique qu'aucun service TCP ne l'?coute. HTTP/HTTPS (80/443) doivent ?tre accessibles pour Nginx et Certbot. Aucun port applicatif ou de base de donn?es ne doit ?tre ouvert publiquement.

## 2. Cloner et configurer

Avec un utilisateur disposant des droits sur `/home/projects` et d'acc?s ? Docker :

```bash
cd /home/projects
git clone git@github.com:BouchardMehdi/loup-garou-api.git
cd loup-garou-api
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

Le d?p?t est priv? : configurer au pr?alable un acc?s GitHub au VPS, par exemple une cl? de d?ploiement en lecture. Ne jamais placer un token dans l'URL du d?p?t ou dans le README.

Modifier `.env` avec un ?diteur et renseigner :

- `POSTGRES_PASSWORD` : le secret g?n?r?, au moins 16 caract?res.
- `APP_ORIGIN=https://loup-garou.bouchard-mehdi.fr` : origine autoris?e du client ; adapter si une interface distincte est ajout?e.
- `API_HOST_PORT=3009` : port libre choisi pour ce projet.
- `NODE_ENV=production`, `TRUST_PROXY_HOPS=1` et un `COMPOSE_PROJECT_NAME` unique et stable.

Conserver `POSTGRES_HOST=db`, `POSTGRES_PORT=5432` et `REDIS_URL=redis://redis:6379` pour Docker. Les identifiants ne sont pas des secrets par d?faut et doivent ?tre fournis par l'exploitant. Les futures variables de session seront document?es avec l'authentification ; aucun JWT_SECRET n'est utilis? actuellement.

## 3. Construire et lancer

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 api
curl --fail http://127.0.0.1:3009/api/health
curl --fail http://127.0.0.1:3009/api/ready
```

L'API attend les contr?les de sant? des bases. Aucun port PostgreSQL ou Redis n'est publi? ; ne pas utiliser `docker-compose.dev.yml` sur le VPS. Les donn?es sont conserv?es dans les volumes nomm?s propres au projet.

`health` v?rifie HTTP ; `ready` v?rifie les deux d?pendances. Docker marque le conteneur unhealthy en cas de panne mais ne le red?marre pas automatiquement pour ce seul motif ; pr?voir une supervision externe. `restart: unless-stopped` couvre l'arr?t du processus et les red?marrages du VPS.

## 4. Configurer Nginx

Adapter `server_name` et les deux occurrences du port dans `deploy/nginx/loup-garou-api.conf` si n?cessaire. Copier ensuite le fichier :

```bash
sudo cp deploy/nginx/loup-garou-api.conf /etc/nginx/sites-available/loup-garou-api
sudo ln -s /etc/nginx/sites-available/loup-garou-api /etc/nginx/sites-enabled/loup-garou-api
sudo nginx -t
sudo systemctl reload nginx
```

Cr?er le lien seulement s'il n'existe pas d?j?. La configuration pr?serve `/api/` et `/socket.io/`, transmet les informations du proxy et permet l'upgrade WebSocket. Le timeout Socket.IO est sup?rieur aux d?lais de ping.

```bash
curl --fail http://loup-garou.bouchard-mehdi.fr/api/health
```

Le chemin `/` renvoie volontairement 404 pour une API seule ; Swagger est accessible sur `/api/docs/`.

## 5. Activer HTTPS

Apr?s r?solution DNS correcte :

```bash
sudo certbot --nginx -d loup-garou.bouchard-mehdi.fr
```

Choisir la redirection HTTP vers HTTPS si l'assistant la propose. V?rifier ensuite :

```bash
sudo nginx -t
curl --fail https://loup-garou.bouchard-mehdi.fr/api/ready
sudo certbot renew --dry-run
```

Le renouvellement doit ?tre planifi? par le m?canisme fourni ? l'installation de Certbot. Ne pas recopier le mod?le HTTP du d?p?t sur une configuration modifi?e par Certbot sans conserver les directives TLS.

V?rifier le transport Socket.IO, m?me si les connexions applicatives sont actuellement refus?es :

```bash
curl --fail 'https://loup-garou.bouchard-mehdi.fr/socket.io/?EIO=4&transport=polling'
```

Une ouverture de transport ne signifie pas qu'un utilisateur est authentifi? ; le namespace refuse actuellement toutes les connexions. Les tests du d?p?t v?rifient ce refus.

## 6. Mettre ? jour

Apr?s int?gration du travail dans `main` :

```bash
cd /home/projects/loup-garou-api
git pull --ff-only
docker compose up -d --build
docker compose ps
docker compose logs --tail=50 api
curl --fail http://127.0.0.1:3009/api/ready
```

Ne pas ex?cuter `docker compose down` pour une mise ? jour habituelle. Ne pas supprimer les volumes. Une seule instance est pr?vue ? ce stade : une recr?ation peut interrompre bri?vement le service et les connexions temps r?el. Le d?ploiement sans interruption et le load balancing restent ? d?velopper pour le cours.

### Quand les premi?res migrations seront ajout?es

Le socle ne comporte aucune table m?tier ni migration. D?s leur ajout, les livraisons avec modification de sch?ma devront faire l'objet d'une sauvegarde pr?alable puis utiliser :

```bash
docker compose --profile tools build api migrate
docker compose --profile tools run --rm migrate
docker compose up -d --no-build api
```

Le service ponctuel `migrate` utilise l'image de build, contenant la CLI Prisma et les migrations versionn?es. Ne jamais utiliser `migrate dev` ni `db push` en production. Si une migration ?choue, arr?ter la proc?dure et examiner l'?tat avant de remplacer l'API. Pr?voir des migrations compatibles avec l'ancienne version pendant le d?ploiement.

## 7. Sauvegardes et retour arri?re

Sauvegarder la base avant toute ?volution de sch?ma et r?guli?rement :

```bash
mkdir -p backups
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "backups/database-$(date +%Y%m%d-%H%M%S).dump"
```

Contr?ler que la commande r?ussit et que l'archive est lisible, conserver des copies hors VPS et tester une restauration dans une base isol?e. Ces archives contiennent des donn?es priv?es ; `backups/` est ignor? par Git. Les fichiers `.env` et la configuration Nginx effective doivent aussi ?tre sauvegard?s en lieu s?r.

Ne pas changer simplement POSTGRES_PASSWORD dans `.env` apr?s initialisation : la variable d'image ne modifie pas le mot de passe du compte existant. Organiser sa rotation dans PostgreSQL et l'application.

Pour revenir ? une version pr?c?dente, utiliser une r?f?rence Git de livraison connue puis reconstruire. Une ancienne image ne r?tablit pas automatiquement un ancien sch?ma de base ; v?rifier sa compatibilit?, sans restauration destructive improvis?e.

## 8. Images versionn?es et prochaines ?tapes

Le workflow `image.yml` teste puis publie une image `ghcr.io/bouchardmehdi/loup-garou-api:vX.Y.Z` quand un tag correspondant est pouss?. Le Compose actuel construit localement ; le d?ploiement depuis GHCR reste une ?volution et n?cessite un acc?s de lecture au registre pour une image priv?e.

Aucun d?ploiement automatique, secret VPS, utilisateur distant ni connexion SSH n'est configur? par ces fichiers. OpenTelemetry/Jaeger et la supervision distante restent ? int?grer.
