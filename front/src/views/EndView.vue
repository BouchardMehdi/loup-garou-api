<script setup>
import { computed } from 'vue'
import { state, me, ROLES, quitGame } from '../store'
import ChatPanel from '../components/ChatPanel.vue'

const g = computed(() => state.game)
const camp = computed(() => (me.value.role === 'loup' ? 'loups' : 'village'))
const won = computed(() => state.winner === camp.value)
</script>

<template>
  <div class="game">
    <div class="stack">
      <section class="panel">
        <h1>{{ state.winner === 'village' ? 'Le village gagne' : 'Les loups gagnent' }}</h1>
        <p class="muted">{{ won ? 'Ton camp a gagné.' : 'Ton camp a perdu.' }} Les rôles sont maintenant visibles.</p>
      </section>
      <section class="panel">
        <h3>Rôles</h3>
        <div class="list">
          <div v-for="p in g.players" :key="p.id">
            <span>{{ p.name }}<span v-if="p.id === me.id" class="tag">toi</span><span v-if="!p.alive" class="tag">mort</span></span>
            <span :class="p.role === 'loup' ? 'error' : ''">{{ ROLES[p.role].label }}</span>
          </div>
        </div>
      </section>
      <button class="btn primary" @click="quitGame">Retour aux salons</button>
    </div>
    <ChatPanel />
  </div>
</template>
