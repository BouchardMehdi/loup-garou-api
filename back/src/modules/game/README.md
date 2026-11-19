# Module jeu

- `domain.ts` : partie, participant, phase et choix, sans framework.
- `service.ts` : composition, rôles cryptographiques, autorisations et projections explicites.
- `engine.ts` : choix nocturnes, votes, transitions, éliminations et victoire ; horloge injectable.
- `infrastructure.ts` : lancement atomique sous verrou parent Lobby et lecture Prisma.
- `engine-repository.ts` : actions et résolutions transactionnelles sous verrou Game.
- `scheduler.ts` : échéances persistées, reprise au démarrage et arrêt sans chevauchement.
- `http.ts` / `openapi.ts` : routes protégées et contrat Swagger.

Les snapshots Prisma contiennent des secrets ; ne jamais les sérialiser directement ou les journaliser. Seuls les participants lisent leur partie ; rôles collectifs révélés uniquement après FINISHED. L’inspection reste privée à la voyante.

Contrats : [lancement](../../../../docs/game-start.md), [moteur](../../../../docs/game-engine.md). Chat et notifications Socket.IO restent à développer.
