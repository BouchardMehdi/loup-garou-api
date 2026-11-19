# Front — Loup-Garou

Vite + Vue 3. Pour l'instant tout tourne sur de fausses données (`src/store.js`), pas besoin du back.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

## Écrans

Connexion → salons → salon d'attente → partie → fin de partie.

## Où est quoi

- `src/store.js` : état, faux serveur, règles d'accès aux chats, outils de démo.
- `src/views/` : un fichier par écran.
- `src/components/` : `PhaseDisc` (lune/soleil + minuteur), `ChatPanel`.

## Brancher l'API

`vite.config.js` proxifie `/api` et `/socket.io` vers le back (port 3009 = exemple, à confirmer avec Mehdi).
Chaque fonction exportée de `store.js` (`login`, `createRoom`, `startGame`, `validate`, `sendMessage`...) deviendra un appel HTTP ou un événement Socket.IO.
Les contrats sont dans `docs/interfaces.md` côté back.

Le client ne décide jamais de ses rooms ni des rôles visibles : tout vient du serveur.
La section « Démo » en bas de la partie est à supprimer une fois l'API branchée.
