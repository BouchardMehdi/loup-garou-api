# Suivi des exigences du cours

Référence : « projet-consignes.pdf », novembre 2026, complété par le plan de cours initial. Le dépôt est public et le VPS cible est celui de l'école, selon confirmation du propriétaire le 19 novembre 2026. Aucune modification de visibilité ou de serveur n'est réalisée par cette branche.

Légende : **présent** = fichier ou socle disponible ; **conçu** = documenté mais à implémenter ; **à développer** = manque identifié ; **à vérifier** = nécessite une preuve d'exécution ou de déploiement. Un élément documenté n'est pas automatiquement un critère satisfait.

| Exigence | Situation au 19 novembre 2026 | Preuve attendue au rendu |
| --- | --- | --- |
| Dépôt public, README et procédure d'utilisation/déploiement | Présent ; visibilité confirmée par le propriétaire | Lien accessible sans connexion et procédure reproduite |
| Git branch flow, commits et travail en binôme | Présent : branches et première PR intégrée | Historique et PR relisibles, contribution et choix expliqués |
| Spécifications Markdown | Conçu dans [specifications.md](specifications.md) | Règles cohérentes avec la démonstration finale |
| C4 System Context | Conçu dans [architecture.md](architecture.md) | Acteurs, frontière système et interactions expliqués |
| MCD | Conçu dans [data-model.md](data-model.md) | Cardinalités et correspondance avec le schéma livré |
| Au moins quatre endpoints REST orientés ressources | Comptes et salons implémentés : création/lecture de salons et participations ; santé/documentation ne sont pas comptées comme métier | Routes métier fonctionnelles, méthodes, headers et statuts corrects |
| Hiérarchie de ressources et HAL ou JSON-LD/Hydra | HAL présent sur comptes, salons, parties et choix personnels | `_links`, `_embedded`, navigabilité et projections protégées |
| Collection paginée | Salons publics paginés implémentés ; historique, messages et statistiques à venir | Pages et liens testés, bornes et ordre stable |
| WebSocket/SSE ou RPC | Transport Socket.IO présent mais connexions applicatives refusées | Chat et événements authentifiés fonctionnels |
| Authentification et autorisations | Comptes, salons et droits de lancement/lecture des parties implémentés ; actions autorisées selon rôle/phase ; chats à développer | Tests de confidentialité, sessions et accès inter-parties |
| ORM et migrations | Comptes, salons, rôles, parties, participants et phases, actions et votes avec quatre migrations ; repositories Prisma implémentés | Client utilisé dans les repositories, migrations versionnées et appliquées |
| Cache des réponses d'API avec Redis | Redis provisionné ; politique de statistiques conçue | Réponse servie depuis le cache, expiration et invalidation démontrées |
| OpenAPI interactive sur `/doc` en développement | `/doc` en développement, `/api/docs/` et contrat des comptes présents | Route demandée accessible en dev et contrat à jour |
| Déploiement sur VPS de l'école et données de test | Guide présent ; cible confirmée ; déploiement à vérifier | Service accessible et partie démontrable avec données de test sans données personnelles réelles |
| HTTP/2 et TLS | Procédure Certbot présente ; HTTP/2 à configurer et vérifier | Négociation HTTP/2 et certificat valide au niveau Nginx |
| CI/CD GitHub Actions ou GitLab CI | Workflows CI et publication par tag présents ; déploiement distant à compléter | Runs réussis, livraison reproductible et étapes de déploiement expliquées |
| Tests, analyse statique/linter et formateur de code en CI | Tests, types et ESLint présents ; formateur à ajouter | CI exécutant aussi une vérification de formatage |
| Images Docker versionnées | Dockerfile et publication GHCR sur tag présents ; exécution à vérifier | Image étiquetée, construite et utilisée pour une livraison |
| Audits de sécurité du code et des images | Audit npm de production en CI ; analyse de code et scan d'image à compléter | Rapports, décisions de traitement et aucun secret versionné |
| Monitoring performances/fiabilité et erreurs centralisées | Logs JSON et gestionnaire HTTP présents ; monitoring/centralisation à développer | Traces/métriques, accès aux erreurs et diagnostic d'un incident |
| Rate-limiting API | Limites des routes applicatives, CSRF, inscriptions et connexions implémentées dans Redis ; chat à venir | Dépassement contrôlé avec réponse 429 ; protection aussi du chat |
| Montée en charge cohérente avec le métier | Script santé présent ; scénario métier à développer | Rapport avec hypothèses, ressources VPS, charge, latence, erreurs et limites |
| Redémarrage après crash ou reboot et healthchecks | Démarrage local, healthchecks et reprise des échéances persistées testés ; crash/reboot VPS à vérifier | Test de crash/reboot, conservation des données et reprise des phases |
| Domaine indépendant du framework, code maintenable | Comptes, salons et moteur : services et ports indépendants d’Express et Prisma | Tests métier sans Express, Socket.IO ou Prisma |
| Application fonctionnelle prioritaire sur la complétude | Partie complète jouable via HTTP ; front à intégrer et chats à développer | Démonstration de bout en bout avec les trois rôles |
| Stack éprouvée Node.js/PHP et composants maintenus | Express/Node.js/TypeScript installés ; versions verrouillées | Choix et risques expliqués, audits suivis |
| Load balancer et OpenTelemetry avec visualisation, annoncés dans le cours initial | Nginx proxy seul ; plusieurs instances et instrumentation à développer | Démonstration de répartition et observabilité selon attentes de l'enseignant |

## Préparation de la soutenance

Présenter : besoin et usage nominal ; architecture et interactions ; ressources CPU/RAM/disque du VPS et allocation aux conteneurs ; démonstration ; CI/CD et qualité ; confidentialité, intégrité et disponibilité ; monitoring et erreurs ; restitution du test de charge. Les assistants IA sont autorisés, mais chaque membre doit savoir expliquer l'implémentation et les choix.

Pondération du livrable : dépôt/versionnement 2 points, conception 10, intégration/déploiement/monitoring 12 et implémentation 6, soit 30 points ramenés sur 20 (coefficient 2). Soutenance sur 20, coefficient 3.

## Scénario de charge cible, à réaliser après le métier

Sur une instance de test avec comptes et salons synthétiques, simuler une montée progressive de participants : connexion, liste paginée, entrée dans des salons, démarrage, messages par canal et votes. Distinguer la charge HTTP de celle de Socket.IO ; un simple client WebSocket ne remplace pas le protocole Socket.IO.

Vérifier sous charge les autorisations, l'absence de vote/fin de phase en double et l'absence de message privé chez un destinataire interdit. Mesurer latences, taux d'erreurs, connexions et consommation des conteneurs. Fixer les objectifs chiffrés en fonction des ressources réellement allouées, avant l'exécution, puis conserver le rapport. Le scénario santé existant ne valide pas ces comportements métier.

## Ordre de mise en œuvre après cette branche

1. Comptes/sessions et protections communes implémentés ; vérifier et maintenir le parcours complet sur chaque livraison.
2. Salons, lancement et moteur de jeu livrés ; maintenir confidentialité, concurrence et reprise des échéances.
3. Chats autorisés, historique, statistiques et cache.
4. Compléter qualité, sécurité, observabilité, livraison et preuves de déploiement/charge tout au long de ces lots.

Ne pas attendre la fin du jeu pour vérifier l'infrastructure ou les droits. Les rôles exclusifs viennent après une première partie complète et fiable.

## Preuves locales du lot comptes

Le 19 novembre 2026 : 19 tests unitaires, 2 tests d'intégration PostgreSQL/Redis dans Docker et un smoke test HTTP complet réussis ; images construites, migration initiale appliquée et seconde exécution sans changement. Les tests utilisent un projet éphémère et ne constituent pas une preuve de déploiement sur le VPS. Les workflows CI restent à exécuter sur GitHub après publication de la branche.

## Preuves locales du lot salons

Le 19 novembre 2026 : 26 tests unitaires et 9 tests d'intégration réussis, smoke test HTTP comptes + salons sur Docker et migration additionnelle appliquée sur une base éphémère. Les tests d'arrivées concurrentes confirment la limite de capacité et l'unicité des adhésions. Le front du collègue n'est pas modifié ni connecté aux routes par ce lot.

## Preuves locales du lancement

Le 19 novembre 2026 : 42 tests unitaires, 24 tests d'intégration et deux smoke tests HTTP Docker réussis. Rôles persistés, première nuit et échéance, refus d'accès hors partie, composition pour tous les effectifs autorisés et concurrence avec les inscriptions/départs sont vérifiés. Ce lot initial ne livrait pas encore les actions et résolutions ; le lot moteur ci-dessous les complète.

## Preuves locales du moteur

Le 19 novembre 2026 : 56 tests unitaires/HTTP, 32 tests d’intégration PostgreSQL/Redis et deux smoke tests Docker réussis. Le scénario à six sessions joue jusqu’à la victoire du village et exerce l’ordonnanceur réel. Les tests vérifient aussi victoire des loups, égalités, abstentions, rôles/cibles interdits, choix privés, doublons, résolutions concurrentes et reprise depuis les échéances persistées avec horloge contrôlée. La quatrième migration est appliquée puis réexécutée sans changement sur une base éphémère. Types, ESLint, build, schéma Prisma et audit npm de production réussissent (0 vulnérabilité signalée). Aucun déploiement VPS ni connexion du front n’est réalisé ; les chats restent à développer.
