# Module comptes

- `domain.ts` : utilisateur, ports repository/hasher et erreurs métier sans framework.
- `service.ts` : inscription, authentification et lecture du profil.
- `infrastructure.ts` : adaptateurs Prisma/PostgreSQL et Argon2id.
- `http.ts` : routes Express, validation Zod, session Redis injectée et protections CSRF.
- `openapi.ts` : contrat exposé dans Swagger.

Le MemoryStore est utilisé uniquement dans les tests unitaires ; le serveur injecte toujours Redis. Les règles et exemples front sont dans [le guide d'authentification](../../../../docs/authentication.md).
