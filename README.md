# Clair de Meute

Projet de cours : back-end d'un jeu de Loup-Garou multijoueur.

Statut : cadrage du projet. L'implémentation n'a pas encore commencé et la stack reste à choisir.

## Fonctionnalités prévues

- Comptes utilisateurs : inscription et connexion.
- Salons publics, visibles dans une liste, et salons privés, accessibles avec un code.
- Démarrage de la partie par le créateur du salon.
- Attribution aléatoire et confidentielle des rôles.
- Trois rôles initiaux : villageois, loup-garou et voyante.
- Alternance jour/nuit, actions nocturnes et vote du village.
- Éliminations et détection automatique de la victoire.
- Historique des parties et statistiques simples.
- Chat en temps réel avec trois canaux distincts par partie.

## Accès aux chats

Les chats sont disponibles à tout moment, indépendamment de la phase jour/nuit.
L'accès dépend de l'état et du rôle du joueur dans la partie.

| Joueur | Chat public de la partie | Chat des loups-garous | Chat des morts |
| --- | --- | --- | --- |
| Villageois vivant | Oui | Non | Non |
| Voyante vivante | Oui | Non | Non |
| Loup-garou vivant | Oui | Oui | Non |
| Joueur mort, quel que soit son rôle | Non | Non | Oui |

Le chat public est le canal commun de la partie, y compris dans un salon privé.
Lorsqu'un joueur meurt, il perd l'accès aux canaux des vivants et accède uniquement au chat des morts.
Les autorisations de lecture et d'envoi devront être vérifiées côté serveur.

## Objectifs techniques du cours

- API RESTful avec HAL ou JSON-LD/Hydra.
- Node.js/Express.js ou PHP/Symfony : choix à définir.
- Base de données avec ORM.
- Mise en cache de réponses avec Redis.
- Répartition de charge avec Nginx ou Apache.
- Conteneurisation Docker et CI/CD avec images versionnées et testées.
- Authentification, autorisations, validation des entrées et limitation des requêtes.
- Tests automatisés et tests de charge avec k6.
- Observabilité avec OpenTelemetry et Grafana ou Jaeger.
- Spécifications, documentation OpenAPI interactive et schéma d'architecture.

Le projet est à réaliser en binôme et à faire valider par l'enseignant.

## Points à définir avant l'implémentation

- Stack technique et modèle de données.
- Nombre de joueurs et répartition des rôles.
- Conditions exactes de victoire et gestion des égalités de vote.
- Durée des phases et gestion des déconnexions.
- Protocole du temps réel et événements échangés.
- Statistiques conservées et informations révélées après la partie.

## Développement

Aucune commande d'installation ou de lancement pour le moment : ce dépôt contient uniquement le cadrage initial.
