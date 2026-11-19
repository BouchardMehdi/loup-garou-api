import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Le port 3009 est un exemple : à confirmer avec Mehdi (voir deploy.md).
const API = 'http://localhost:3009'

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': API,
      '/socket.io': { target: API, ws: true },
    },
  },
})
