<script setup>
import { ref } from 'vue'
import { state, createRoom, joinLobby, joinByCode } from '../store'

const name = ref('')
const priv = ref(false)
const code = ref('')
const error = ref('')

function create() {
  error.value = ''
  if (name.value.trim().length < 3) return (error.value = 'Donne un nom d’au moins 3 caractères au salon.')
  createRoom(name.value.trim(), priv.value)
}
function join() {
  error.value = ''
  if (!joinByCode(code.value.trim())) error.value = 'Code invalide : il fait 6 caractères.'
}
</script>

<template>
  <div class="cols">
    <section class="panel">
      <h2>Salons publics</h2>
      <div v-if="state.lobbies.length" class="list">
        <div v-for="l in state.lobbies" :key="l.id">
          <span>{{ l.name }} <span class="muted">· {{ l.players }}/12</span></span>
          <button class="btn" @click="joinLobby(l)">Rejoindre</button>
        </div>
      </div>
      <p v-else class="muted">Aucun salon ouvert. Crée le premier.</p>
    </section>

    <div class="stack">
      <section class="panel stack">
        <h2>Créer un salon</h2>
        <label class="field"><span>Nom du salon</span><input v-model="name" @keyup.enter="create" /></label>
        <label class="row"><input v-model="priv" type="checkbox" /> Salon privé (accès par code)</label>
        <button class="btn primary" @click="create">Créer le salon</button>
      </section>
      <section class="panel stack">
        <h2>Rejoindre avec un code</h2>
        <div class="row">
          <input v-model="code" class="grow" maxlength="6" placeholder="ABC123" @keyup.enter="join" />
          <button class="btn" @click="join">Rejoindre</button>
        </div>
      </section>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </div>
  </div>
</template>
