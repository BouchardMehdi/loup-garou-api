# Module jeu — lancement

- `domain.ts` : partie, participant, phase et port de persistance sans framework.
- `service.ts` : composition, mélange cryptographique des rôles, autorisations et projections publique/personnelle explicites.
- `infrastructure.ts` : création atomique sous le même verrou parent Lobby que les participations de salon.
- `http.ts` / `openapi.ts` : routes protégées et contrat Swagger.

Le lancement fige pseudonymes, rôles et durées ; aucun rôle n'est envoyé dans la réponse de lancement ou l'état collectif. Le catalogue des trois rôles est initialisé par migration. Les entités contenant roleCode ne doivent jamais être sérialisées directement ni journalisées.

La première nuit et son échéance sont persistées. Aucun ordonnanceur, action nocturne, vote, élimination, victoire ou chat n'est implémenté par ce lot. Voir [le contrat](../../../../docs/game-start.md).
