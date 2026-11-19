# Authentification — contrat pour le front

Ce dépôt développe uniquement le back-end. Le front est réalisé séparément par le collègue. Les salons, parties et chats restent à implémenter ; Socket.IO refuse encore les connexions applicatives, même après une connexion HTTP réussie.

## Routes disponibles

| Méthode et chemin | Entrée | Réponse normale |
| --- | --- | --- |
| `GET /api/csrf` | Cookie éventuel | 200, `{ csrfToken }`, création d'une session anonyme si nécessaire |
| `POST /api/users` | `{ username, email, password }` | 201, profil personnel HAL, `Location: /api/users/{id}` ; pas de connexion automatique |
| `POST /api/sessions` | `{ email, password }` | 201, `{ user, csrfToken, _links }`, nouvel identifiant de session et nouveau jeton CSRF |
| `GET /api/me` | Session authentifiée | 200, profil personnel HAL |
| `GET /api/users/{id}` | Sa propre identité uniquement | 200, même profil ; 404 pour un autre utilisateur |
| `GET /api/sessions/current` | Session authentifiée | 200, `{ authenticated, expiresAt, _links }` ; aucun identifiant de session |
| `DELETE /api/sessions/current` | Session authentifiée et CSRF | 204, session supprimée de Redis et cookie effacé |

Les profils contiennent `id`, `username`, `email`, `createdAt` et des liens HAL. Aucune empreinte de mot de passe, clé de normalisation ou clé Redis n'est renvoyée. Les réponses d'authentification portent `Cache-Control: no-store`.

## Intégration navigateur

Toutes les requêtes doivent utiliser `credentials: 'include'`. Le cookie `loup.sid` est HttpOnly : le front ne le lit pas et ne stocke pas d'identifiant de session dans localStorage. Conserver le jeton CSRF en mémoire et le récupérer à nouveau au rechargement.

```javascript
const API = 'http://localhost:3009'; // URL du back ; APP_ORIGIN est celle du front.
let csrfToken;

async function refreshCsrf() {
  let response = await fetch(`${API}/api/csrf`, { credentials: 'include' });
  // Une session expirée est détruite lors de la première requête.
  if (response.status === 401) {
    response = await fetch(`${API}/api/csrf`, { credentials: 'include' });
  }
  if (!response.ok) throw new Error('Impossible de préparer la session');
  csrfToken = (await response.json()).csrfToken;
}

async function mutation(path, method, body) {
  const response = await fetch(`${API}${path}`, {
    method, credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw await response.json();
  return response.status === 204 ? undefined : response.json();
}

await refreshCsrf();
await mutation('/api/users', 'POST', {
  username: 'Alice', email: 'alice@example.test', password: 'mot-de-passe-long-et-unique',
});
const login = await mutation('/api/sessions', 'POST', {
  email: 'alice@example.test', password: 'mot-de-passe-long-et-unique',
});
csrfToken = login.csrfToken; // Le jeton anonyme est désormais invalide.
const profile = await fetch(`${API}/api/me`, { credentials: 'include' }).then(r => r.json());
await mutation('/api/sessions/current', 'DELETE');
csrfToken = undefined;
```

`Origin` est envoyé automatiquement par le navigateur pour les mutations ; il doit correspondre exactement à `APP_ORIGIN`, sans slash final ni chemin. Un client CLI doit envoyer ce header explicitement. Le jeton doit appartenir au même cookie de session ; un jeton d'un autre navigateur ne convient pas.

Aucun renouvellement automatique d'une mutation après 401/403 : récupérer un jeton et, si nécessaire, reconnecter l'utilisateur avant une nouvelle action explicite. Ne pas rejouer aveuglément une inscription après un échec réseau.

## Validation et erreurs

- Pseudonyme : 3 à 24 lettres ASCII, chiffres ou underscores ; espaces périphériques retirés. Unicité sans distinction de casse.
- E-mail : syntaxe valide, maximum 254 caractères, espaces périphériques retirés et normalisation en minuscules ; unicité.
- Mot de passe d'inscription : 12 à 128 caractères ; aucun retrait d'espaces ni modification du contenu. Lors de la connexion : 1 à 128 caractères.
- Champs supplémentaires refusés. Inscription et connexion en JSON. Corps limité à 32 Kio.
- 400 : validation/JSON invalide ; 401 : session absente/expirée ou identifiants incorrects ; 403 : Origin ou CSRF interdit ; 409 : compte déjà existant ; 413 : corps trop volumineux ; 429 : limite dépassée ; 503 : contrôle de limite indisponible ; 500 : erreur interne non détaillée.
- Les erreurs contrôlées ont `{ code, error }`. Les erreurs JSON et erreurs internes du socle peuvent avoir uniquement `{ error }`. La même erreur de connexion est renvoyée pour un e-mail inconnu et un mauvais mot de passe, avec vérification Argon2id factice dans le premier cas.

## Sessions, cookies et limites

`SESSION_SECRET` est obligatoire (au moins 32 caractères), généré aléatoirement et conservé hors Git. Expiration absolue : `SESSION_TTL_SECONDS`, 28 800 secondes par défaut (8 h), entre 60 secondes et 7 jours. Les requêtes ne prolongent pas cette durée ; Redis conserve les sessions avec TTL et le serveur contrôle aussi leur date de création.

En production, cookies Secure + HttpOnly, domaine omis (cookie propre à l'hôte API), `SameSite=lax` par défaut. L'origine autorisée doit être HTTPS. Deux sous-domaines HTTPS de `bouchard-mehdi.fr` sont compatibles avec ce choix. Pour un front sur un autre site, `SESSION_SAME_SITE=none` exige la production HTTPS ; les politiques de blocage des cookies tiers du navigateur peuvent encore s'appliquer.

En développement HTTP, définir `NODE_ENV=development` et une origine de front telle que `http://localhost:5173`. Ne pas utiliser ce mode sur le VPS. `/doc` est servi uniquement en développement ; `/api/docs/` et `/api/openapi.json` restent disponibles. Les essais Swagger sont des requêtes navigateur et doivent eux aussi respecter l'origine autorisée ; pour les tester sans front, choisir l'origine du back comme APP_ORIGIN.

Limites Redis partagées par IP : 300 requêtes/minute sur les routes API applicatives, 30 préparations CSRF/minute, 5 tentatives d'inscription/heure, 10 tentatives de connexion/15 minutes. Les tentatives échouées comptent aussi. Les routes techniques santé/docs sont exclues. 429 inclut `Retry-After` en secondes. Le rate-limiting utilise une opération Redis atomique et refuse les requêtes si ce contrôle échoue ; aucun fallback mémoire en production. Une session peut aussi échouer avec une erreur interne contrôlée si son store est indisponible.

## Données et tests

Migration `20261119000100_create_users` : table User, identifiant UUID, pseudonyme et clé de pseudonyme normalisée unique, e-mail unique, empreinte Argon2id et date de création. Argon2id utilise mémoire 19 456 Kio, deux passes et parallélisme 1. Les rôles, parties et messages n'ont pas encore de tables.

`npm test` vérifie le domaine et les routes avec un repository et un store de test, plus un vrai hachage Argon2id. `npm run test:integration` est réservé à PostgreSQL/Redis isolés et exige `RUN_INTEGRATION=1` ; les paramètres de base et Redis doivent viser exclusivement cette instance de test. Il vérifie la persistance, les contraintes d'unicité, les TTL, la révocation et le compteur atomique.

Le smoke test de la CI s'exécute dans le conteneur API d'un projet Compose éphémère : inscription, empreinte persistée, connexion, rotation, lecture du profil, CSRF et déconnexion. Il n'est pas destiné à une base contenant les utilisateurs réels.

Pour un environnement de développement/test isolé, la commande recommandée est `docker compose --profile test run --build --rm integration` : elle exécute les tests depuis le réseau Docker et ne nécessite pas de publier les bases. Elle ne doit pas être lancée avec la configuration ou la base de production. La CI utilise ce service de test en plus du smoke test HTTP ; l'image de production ne contient pas les tests ni leurs dépendances de développement.
