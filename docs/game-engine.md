# Moteur de jeu — contrat back-end

Le jeu peut être joué jusqu'à la victoire avec les trois rôles via HTTP. Le front Vue du collègue est conservé. Les chats, événements Socket.IO, historique paginé et statistiques restent à développer. Voir [lancement](game-start.md) et [authentification](authentication.md).

## Actions et votes

Toutes les routes nécessitent une session valide. Les POST exigent `Origin: APP_ORIGIN` et `X-CSRF-Token` ; le front envoie les cookies avec `credentials: "include"`. Le corps contient uniquement `targetUserId`, obligatoire : UUID du **compte utilisateur**, ou `null` pour s'abstenir. Ne pas envoyer l'identifiant GameParticipant, le rôle, le type d'action ou l'horloge.

| Méthode et chemin | Usage |
| --- | --- |
| `POST /api/games/{gameId}/phases/{phaseId}/night-actions` | Loup : cibler un vivant non-loup ; voyante : inspecter un autre vivant ; villageois : interdit |
| `GET /api/games/{gameId}/phases/{phaseId}/night-actions/me` | Retrouver uniquement sa propre action, même après clôture |
| `POST /api/games/{gameId}/phases/{phaseId}/votes` | Chaque vivant peut voter contre un autre vivant, ou s'abstenir |
| `GET /api/games/{gameId}/phases/{phaseId}/votes/me` | Retrouver uniquement son propre bulletin |

Exemple :

```json
{"targetUserId": null}
```

Succès POST : **201**, représentation HAL et `Location` vers la lecture personnelle. Exemple de résultat d'inspection (identifiants illustratifs) :

```json
{
  "id": "UUID_ACTION",
  "gameId": "UUID_PARTIE",
  "phaseId": "UUID_PHASE",
  "kind": "SEER_INSPECT",
  "targetUserId": "UUID_COMPTE_CIBLE",
  "submittedAt": "2026-11-19T12:00:15.000Z",
  "inspection": {"targetUserId": "UUID_COMPTE_CIBLE", "role": "WEREWOLF"},
  "_links": {
    "self": {"href": "/api/games/UUID_PARTIE/phases/UUID_PHASE/night-actions/me"},
    "game": {"href": "/api/games/UUID_PARTIE"}
  }
}
```

Pour une attaque, un vote ou une abstention, `inspection` vaut `null`. Le serveur déduit `WOLF_ATTACK`, `SEER_INSPECT` ou `VILLAGE_VOTE`. Un choix est définitif : aucune modification ni suppression. Une seconde requête renvoie 409, avec `CHOICE_ALREADY_SUBMITTED` si la phase est encore ouverte, sinon `PHASE_CLOSED` ou `GAME_FINISHED`. Après perte d'une réponse, lire la route personnelle de la phase avant toute nouvelle tentative.

## Phases et échéances

`NIGHT` → `DAY_DISCUSSION` → `DAY_VOTE` → `NIGHT` du cycle suivant. Le débat garde sa durée entière. Nuit et vote finissent lorsque tous les acteurs vivants attendus ont validé, abstentions comprises, ou à l'échéance. La nuit attend les loups vivants et la voyante vivante ; le vote attend tous les vivants. Une voyante déjà morte n'est plus attendue.

Les attaques des loups et les votes du village utilisent le maximum unique : égalité ou absence de voix = aucune victime. Les abstentions et choix absents ne comptent pour aucune cible. Les morts ne peuvent plus agir ni être ciblés ; aucune auto-cible, y compris lors du vote. La victime nocturne meurt à la résolution : une inspection déjà validée reste disponible à la voyante même si elle est tuée cette nuit-là.

Le serveur rejette tout choix reçu **à partir** de l'échéance. Une requête tardive peut d'abord résoudre la phase échue, puis répondre 409 sans enregistrer le choix tardif. Une déconnexion n'arrête pas l'horloge et ne retire pas le joueur.

Un ordonnanceur démarre avec l'API, consulte PostgreSQL toutes les `GAME_TICK_INTERVAL_MS` (1000 ms par défaut, 250–60000) et traite jusqu'à 50 parties échues par passage. Sous charge ou indisponibilité, une résolution peut être retardée ; la date limite continue d'interdire les choix tardifs. Il ne dépend pas d'une page web ouverte ni de minuteries par partie en mémoire. Après arrêt, le prochain démarrage résout les phases échues ; la nouvelle phase commence à la reprise avec sa durée entière, sans dérouler artificiellement plusieurs cycles manqués. Aucun endpoint de résolution manuelle n'est exposé.

## Lectures et intégration front

`GET /api/games/{gameId}` retourne l'état collectif réservé aux participants, avec `phase` et son échéance, états `ALIVE`/`DEAD`, `lastResolution` (phase, type, cycle, resolvedAt, eliminatedUserId nullable), résultat et liens HAL. Aucun bulletin, cible nocturne ou inspection n'y apparaît. Avant la première résolution, `lastResolution` vaut `null`. Ce champ décrit la dernière phase clôturée, y compris un débat sans victime ; les états des participants restent la référence des éliminations déjà survenues.

`GET /api/games/{gameId}/participants/me` ajoute `currentChoice` (son choix pour la phase ouverte ou null) et `inspections` (phaseId, targetUserId, role, createdAt ; seulement ses découvertes de voyante, y compris après élimination). Les coéquipiers loups vivants ne sont exposés qu'à un loup vivant. Les résultats individuels des autres participants ne sont jamais lisibles, même avec leur identifiant de ressource.

Pour le front : relire les deux états après une action et périodiquement pendant la partie, par exemple toutes les deux secondes, avec reprise après reconnexion. Afficher le compte à rebours à partir de l'échéance serveur ; le serveur reste l'arbitre. Socket.IO refuse encore les connexions et n'émet aucun événement de phase. Les réponses personnelles utilisent `Cache-Control: no-store`.

## Fin de partie

Après chaque résolution nocturne ou de vote : aucun loup vivant → `VILLAGE` ; loups au moins aussi nombreux que les autres vivants → `WEREWOLVES`. Sinon la partie continue. Les participants morts partagent le résultat de leur camp.

La victoire enregistre `status: FINISHED`, `winner`, `finishedAt`, clôture la phase et passe le salon à `FINISHED`, sans créer de phase suivante. `phase` devient null. La projection collective révèle alors `role` et `team` de tous les participants, aux seuls participants ; les non-participants restent refusés. Aucun chat d'après-partie n'est encore ouvert par cette livraison.

## Erreurs

| Statut | Codes et causes |
| --- | --- |
| 400 | `VALIDATION_ERROR` : identifiant/corps invalide ; `TARGET_FORBIDDEN` : soi-même, mort ou coéquipier loup |
| 401/403 | Session absente, Origin/CSRF invalide ; `PLAYER_DEAD` ou `ROLE_FORBIDDEN` |
| 404 | `GAME_NOT_FOUND` : partie absente ou non-participant ; `TARGET_NOT_FOUND` ; `CHOICE_NOT_FOUND` pour la lecture de son choix absent |
| 409 | `GAME_FINISHED`, `PHASE_CLOSED`, `WRONG_PHASE`, `CHOICE_ALREADY_SUBMITTED` |
| 429 | Limite globale ou 60 soumissions/minute/IP, avec `Retry-After` |
| 503 | Limiteur Redis indisponible |

## Persistance et concurrence

La quatrième migration, `20261119000400_create_game_engine`, ajoute NightAction, VillageVote et la victime éventuelle de chaque phase. Clés étrangères composites : phase, acteur et cible appartiennent à la même partie ; unicité du choix par acteur/phase, interdiction SQL d'auto-cible et cohérence du résultat d'inspection. Les index partiels existants (adhésions actives et une seule phase ouverte par partie) sont conservés. Un index partiel sur les échéances accélère le traitement.

Chaque soumission ou résolution verrouille la ligne Game dans une transaction PostgreSQL. Les acteurs, cibles et échéances sont vérifiés après acquisition du verrou. La phase est fermée avant création de la suivante ; choix, élimination, victoire et statut du salon sont atomiques. Plusieurs traitements peuvent se concurrencer sans doubler les effets. Les snapshots Prisma contiennent des secrets : utiliser les projections explicites et ne pas les journaliser.

## Vérification

Les tests métier couvrent règles, confidentialité, erreurs, fins anticipées, échéances, égalités, victoires et arrêt de l'ordonnanceur. Les tests PostgreSQL isolés vérifient contraintes, doublons concurrents, résolutions concurrentes et reprise depuis les données persistées. Le smoke test Docker à six sessions joue une partie complète et vérifie l'ordonnanceur réel ; il raccourcit uniquement le débat de sa propre fixture isolée. Ne jamais exécuter ces scénarios sur les données réelles ou la production.
