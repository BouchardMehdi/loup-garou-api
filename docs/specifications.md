# Spécifications fonctionnelles — première version

Statut : conception validée le 19 novembre 2026, partiellement implémentée. Les comptes et sessions sont disponibles selon le [guide d’authentification](authentication.md), ainsi que les [salons et participations](lobbies.md). Le [lancement et les rôles personnels](game-start.md) sont disponibles ; les [actions, transitions et victoires](game-engine.md) sont implémentées. Les chats, historique paginé et statistiques restent à développer. Référence du cours : « projet-consignes.pdf » fourni par l'enseignant en novembre 2026.

Documents associés : [MCD](data-model.md), [interfaces préliminaires](interfaces.md), [architecture et contexte C4](architecture.md), [suivi des exigences](requirements.md).

## 1. Objectif et périmètre

Permettre à un groupe de 6 à 12 utilisateurs connectés de jouer au Loup-Garou. Le serveur attribue les rôles, arbitre les actions, fait progresser les phases et protège les informations privées.

La première version comprend comptes, salons publics/privés, trois rôles, votes, trois chats pendant la partie, un canal d'après-partie, historique personnel et statistiques simples. Les rôles exclusifs, spectateurs, chat d'avant-partie, matchmaking, modération et abandon manuel ne font pas partie de cette version. Le front-end de démonstration sera minimal et reste à réaliser.

Les conventions complémentaires de cette conception (cycle de vie du salon, exposition des résultats et périmètre avant/après-partie) fixent un comportement minimal pour la V1 ; toute évolution doit être répercutée dans les contrats et les consignes communes.

## 2. Parcours utilisateur et salons

1. L'utilisateur crée un compte avec pseudonyme, e-mail et mot de passe, puis se connecte. L'e-mail et le mot de passe ne sont jamais exposés aux autres joueurs.
2. Il crée un salon ou rejoint un salon public listé. Un salon privé n'apparaît pas dans cette liste et nécessite un code d'invitation.
3. Le créateur compte parmi les joueurs. Il choisit une capacité de 6 à 12 places et les durées des phases ; les autres participants voient ces réglages avant le départ.
4. Le créateur peut lancer dès que 6 joueurs au minimum sont inscrits, dans la limite de la capacité. La composition dépend de l'effectif réel au lancement, pas de la capacité maximale.
5. Le serveur verrouille les inscriptions et les réglages, crée la partie et distribue les rôles. La première phase est une nuit.
6. Les joueurs participent jusqu'à la victoire d'un camp, puis consultent le résultat et le canal d'après-partie.

États du salon : `WAITING`, `IN_GAME`, `FINISHED`, `CLOSED`. Une seule partie par salon dans cette version ; une revanche passe par un nouveau salon. Seuls les salons publics `WAITING` figurent dans la collection publique, y compris les salons complets dont le nombre de places est indiqué.

Un membre peut quitter un salon en attente. Si le créateur quitte explicitement le salon, la propriété passe au membre présent depuis le plus longtemps ; sans membre restant, le salon est fermé. Une déconnexion réseau seule ne fait pas quitter le salon et ne transfère pas sa propriété. En partie, quitter l'interface ou se déconnecter ne supprime pas la participation.

## 3. Rôles et victoire

| Joueurs au lancement | Loups-garous | Voyante | Villageois |
| --- | --- | --- | --- |
| 6 | 1 | 1 | 4 |
| 7 | 1 | 1 | 5 |
| 8 | 2 | 1 | 5 |
| 9 | 2 | 1 | 6 |
| 10 | 2 | 1 | 7 |
| 11 | 3 | 1 | 7 |
| 12 | 3 | 1 | 8 |

L'attribution est aléatoire et réalisée côté serveur. La voyante appartient au camp du village. Un joueur voit son propre rôle ; les loups connaissent leurs coéquipiers. Les autres rôles restent secrets jusqu'au résultat final, sauf découverte individuelle par la voyante. Une élimination publique annonce le joueur éliminé sans révéler son rôle.

Après chaque résolution de nuit ou de vote, vérifier dans cet ordre :

1. Aucun loup vivant : victoire du village.
2. Au moins autant de loups que de joueurs des autres rôles encore vivants : victoire des loups.
3. Sinon, continuer avec la phase suivante.

La victoire est celle d'un camp : un membre éliminé partage le résultat de son camp. Le créateur ne peut ni choisir les rôles ni modifier le résultat.

## 4. Phases, actions et résolution

Cycle : `NIGHT` → résolution → `DAY_DISCUSSION` → `DAY_VOTE` → résolution → nouvelle nuit. Une résolution victorieuse termine immédiatement la partie, sans créer la phase suivante.

| Phase | Valeur initiale | Limites réglables par le créateur | Fin anticipée |
| --- | --- | --- | --- |
| Débat | 180 secondes | 30 à 300 secondes incluses | Non |
| Vote | 60 secondes | 30 à 300 secondes incluses | Tous les vivants ont validé |
| Nuit | 60 secondes | 30 à 300 secondes incluses | Tous les loups vivants et la voyante vivante ont validé |

Chaque durée est un nombre entier de secondes, défini avant le départ et copié dans la partie. Les échéances reposent sur l'horloge serveur ; un client ne déclenche pas la résolution. Les choix validés sont définitifs pour la phase. Une abstention explicite permet de valider sans cible. Un choix reçu après clôture ou à partir de l'échéance est refusé, même si un traitement différé n'a pas encore résolu la phase.

### Nuit

- Chaque loup vivant dépose un choix individuel contre un joueur vivant extérieur au camp des loups, ou s'abstient. Les choix ne sont pas visibles publiquement ; la coordination passe par le chat des loups.
- La cible ayant seule le plus de voix des loups est éliminée. Égalité au maximum, abstention générale ou absence de choix : aucune victime. Les abstentions ne sont pas des voix contre une cible.
- La voyante vivante choisit un autre joueur vivant ou s'abstient. Une inspection validée lui révèle immédiatement et uniquement à elle le rôle exact de sa cible. Elle ne tue pas et ne protège personne.
- Les acteurs et cibles sont évalués dans l'état vivant de cette nuit. La victime ne meurt qu'à la résolution : une voyante qui a inspecté avant d'être tuée a pu recevoir son résultat. Aucun ordre arbitraire entre actions ne doit annuler une inspection déjà validée.
- À l'échéance, une action absente n'a pas d'effet. Un villageois n'a aucune action nocturne à envoyer.

### Débat et vote

Le débat dure jusqu'à son échéance. Les bulletins individuels restent privés pendant le vote ; le résultat annonce la cible éliminée ou l’absence d’élimination, sans publier les bulletins. Durant `DAY_VOTE`, chaque vivant peut voter une fois contre un autre vivant ou s'abstenir. Seule une cible ayant le maximum unique de voix est éliminée. Égalité ou absence de voix : aucune élimination.

### Concurrence et reprise

Une seule résolution est autorisée par phase. Actions, échéances, choix validés et résultats doivent être persistés ; un redémarrage ne redistribue pas les rôles et n'efface pas les votes. À la reprise, résoudre les phases échues puis reprendre la progression. Chaque nouvelle phase débute à la résolution effective et reçoit sa durée entière, sans dérouler plusieurs cycles manqués. Les traitements simultanés ne doivent pas produire plusieurs éliminations, plusieurs parties pour un salon ou plusieurs votes d'un même joueur.

Les déconnexions n'arrêtent pas le chronomètre, ne tuent pas le joueur et ne le font pas changer de camp. À la reconnexion, restituer l'état courant autorisé. Si tous s'abstiennent ou sont absents, les phases peuvent continuer sans élimination ; aucun gagnant ou abandon automatique n'est inventé pour ce cas dans cette version.

## 5. Chats et confidentialité

Les accès s'appliquent à la lecture de l'historique, à l'envoi et à la diffusion en direct. Ils sont indépendants de la phase jour/nuit.

| Participant pendant la partie | `PUBLIC` | `WOLVES` | `DEAD` |
| --- | --- | --- | --- |
| Villageois ou voyante vivant | Oui | Non | Non |
| Loup vivant | Oui | Oui | Non |
| Mort, quel que soit son rôle | Non | Non | Oui |

Le chat public est commun à cette partie, même si le salon est privé ; il n'est pas accessible aux visiteurs du site. Un joueur éliminé perd immédiatement l'accès serveur aux chats des vivants sur toutes ses connexions et rejoint celui des morts. L'accès à un canal autorisé donne accès à son historique de la partie. Le serveur ne peut pas effacer de la mémoire d'un joueur ce qu'il avait déjà lu, mais refuse les nouvelles lectures et diffusions interdites.

À la fin, tous les participants voient les rôles et disposent d'un canal distinct `POST_GAME`. Les trois anciens canaux sont en lecture seule et conservent les droits correspondant à l'état final du joueur : un mort ne retrouve pas les historiques public ou loups. Les non-participants restent exclus. Aucun message de chat ne figure dans les statistiques publiques ou les logs.

## 6. Historique et statistiques

Chaque utilisateur retrouve une collection paginée de ses parties terminées : dates, camp gagnant, rôle personnel et résultat personnel. Le détail d'une partie terminée et sa liste de rôles sont réservés à ses participants. Ses statistiques simples comptent parties terminées, victoires et défaites ; une déconnexion ne supprime pas une participation. Une partie en cours ne compte pas encore dans ces totaux.

Une collection de statistiques publiques expose uniquement pseudonyme, parties terminées, victoires et défaites ; elle est mise en cache avec Redis. Aucun rôle, message, e-mail, code privé ou état secret en cours n'entre dans ce cache. Les identifiants de compte restent privés hors besoins d'identification des participants. La politique de durée de conservation et de suppression de compte devra être fixée avant mise en production des données réelles.

## 7. Scénarios d'acceptation futurs

Ces scénarios sont à convertir en tests lors du développement ; ils ne décrivent pas des tests déjà exécutés.

| ID | Situation | Résultat attendu |
| --- | --- | --- |
| A01 | Lancement avec 5 joueurs, ou par un non-créateur | Refus ; aucun rôle ni partie créé |
| A02 | Lancement à 6 puis à 12 joueurs | Respectivement 1/1/4 et 3/1/8 ; rôles privés, première nuit |
| A03 | Deux lancements concurrents ou inscription au même instant | Au plus une partie ; effectif figé atomiquement |
| A04 | Durées 30 ou 300, puis 29 ou 301 secondes | Bornes acceptées, valeurs hors limites refusées |
| A05 | Tous les acteurs de nuit ont validé, puis tous les votants | Résolution anticipée ; le débat conserve toute sa durée |
| A06 | Égalité, tous abstentionnistes ou aucune voix | Aucune victime, au village comme chez les loups |
| A07 | Action absente, acteur mort, mauvaise phase, cible interdite ou choix déjà validé | Absence sans effet ; autres actions refusées sans fuite de rôle |
| A08 | Voyante inspectant une cible alors qu'elle est victime de la nuit | Résultat privé reçu ; élimination à la résolution |
| A09 | Dernier loup éliminé, ou nombre de loups atteignant la parité | Victoire correcte ; une seule fin, plus d'action métier |
| A10 | Élimination d'un loup connecté dans deux onglets | Les deux connexions perdent les canaux des vivants ; seul le chat des morts reste accessible |
| A11 | Déconnexion, reconnexion et redémarrage serveur | Rôle et participation conservés ; état et droits courants restaurés ; pas de résolution double |
| A12 | Fin de partie | Rôles révélés aux participants, canal commun ouvert, anciens chats en lecture seule selon droits finaux |
| A13 | Visiteur ou utilisateur hors partie | Aucun rôle, détail privé, code de salon ni historique de chat accessible |
| A14 | Partie achevée avec joueur éliminé ou déconnecté | Résultat de son camp compté une seule fois dans ses statistiques |
| A15 | Créateur quittant un salon en attente | Transfert au membre le plus ancien, ou fermeture si salon vide |
| A16 | Tentative de quitter/rejoindre pour modifier les rôles après lancement | Aucune nouvelle participation ni redistribution |

## 8. Évolutions hors de cette branche

Comptes, sessions, salons, lancement, actions, résolution et victoire sont livrés. Développer ensuite les chats, historique et statistiques avec migrations et tests. Les futurs rôles exclusifs devront décrire camp, pouvoir, phase, limites, interactions, victoire et droits de chat avant leur implémentation. La documentation de conception seule ne prouve pas la conformité technique du produit final.
