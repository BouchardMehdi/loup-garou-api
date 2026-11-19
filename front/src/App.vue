<script setup>
import { computed, watchEffect } from 'vue'
import { state, logout } from './store'
import AuthView from './views/AuthView.vue'
import LobbiesView from './views/LobbiesView.vue'
import RoomView from './views/RoomView.vue'
import GameView from './views/GameView.vue'
import EndView from './views/EndView.vue'

const views = { auth: AuthView, lobbies: LobbiesView, room: RoomView, game: GameView, end: EndView }

// Le thème suit le jeu : nuit pendant la nuit, jour pour le débat, le vote et la fin.
const theme = computed(() => {
  if (state.screen === 'end') return 'day'
  if (state.screen === 'game' && state.game.phase !== 'night') return 'day'
  return 'night'
})
watchEffect(() => { document.documentElement.dataset.theme = theme.value })
</script>

<template>
  <div class="wrap">
    <header class="top">
      <span class="brand">Loup-Garou</span>
      <div v-if="state.user" class="row">
        <span class="muted">{{ state.user.name }}</span>
        <button class="btn" @click="logout">Se déconnecter</button>
      </div>
    </header>
    <component :is="views[state.screen]" />
  </div>
</template>
