# Module salons

`domain.ts` définit les entités et ports ; `service.ts` applique capacité, confidentialité, départ et succession du propriétaire ; `infrastructure.ts` implémente les transactions Prisma/PostgreSQL ; `http.ts` valide les requêtes et projette les ressources HAL ; `openapi.ts` documente le contrat.

Les routes sont montées après le middleware partagé des comptes : session Redis, expiration absolue, CSRF, Origin et limite globale. Aucune route de salon ne doit être montée sans cette chaîne.

Les mutations de participation verrouillent la ligne Lobby avec SELECT FOR UPDATE avant de compter ou modifier les membres. Un index PostgreSQL unique partiel empêche deux appartenances actives identiques. Il est défini explicitement dans la migration et doit être conservé dans les migrations futures ; les anciennes appartenances conservent leftAt.

Le front et les règles de lancement ne sont pas modifiés. Voir [le contrat des salons](../../../../docs/lobbies.md).
