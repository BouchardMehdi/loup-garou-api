<script setup>
import { computed } from 'vue'
import { state, leaveRoom, startGame, fillDemo, setDuration } from '../store'

const room = computed(() => state.room)
const isOwner = computed(() => room.value.ownerId === state.user.id)
const n = computed(() => room.value.players.length)
const canStart = computed(() => isOwner.value && n.value >= 6 && n.value <= 12)
const hint = computed(() => {
  if (!isOwner.value) return 'Le créateur lance la partie.'
  if (n.value < 6) return `Il manque ${6 - n.value} joueur${6 - n.value > 1 ? 's' : ''} (6 minimum).`
  return 'Prêt à jouer. Les réglages sont figés au lancement.'
})
const fields = [['night', 'Nuit'], ['debate', 'Débat'], ['vote', 'Vote']]
</script>

<template>
  <div class="cols">
    <section class="panel stack">
      <div class="row between">
        <h2>{{ room.name }}</h2>
        <button class="btn" @click="leaveRoom">Quitter</button>
      </div>
      <div v-if="room.isPrivate">
        <span class="muted">Code du salon</span>
        <div class="code">{{ room.code }}</div>
      </div>
      <h3>Joueurs ({{ n }}/12)</h3>
      <div class="list">
        <div v-for="p in room.players" :key="p.id">
          <span>{{ p.name }}<span v-if="p.id === room.ownerId" class="tag">créateur</span></span>
        </div>
      </div>
    </section>

    <section class="panel stack">
      <h2>Durées (secondes)</h2>
      <div class="row">
        <label v-for="[key, label] in fields" :key="key" class="field grow">
          <span>{{ label }}</span>
          <input type="number" min="30" max="300" :value="room.settings[key]" :disabled="!isOwner" @change="setDuration(key, $event.target)" />
        </label>
      </div>
      <p class="muted">{{ hint }}</p>
      <button class="btn primary" :disabled="!canStart" @click="startGame">Lancer la partie</button>
      <div class="demo">
        <button class="btn" @click="fillDemo">Démo : ajouter des faux joueurs</button>
      </div>
    </section>
  </div>
</template>
