<script setup>
import { ref } from 'vue'
import { login } from '../store'

const mode = ref('login')
const pseudo = ref('')
const pass = ref('')
const error = ref('')

function submit() {
  error.value = ''
  if (pseudo.value.trim().length < 3) return (error.value = 'Le pseudo doit faire au moins 3 caractères.')
  if (pass.value.length < 8) return (error.value = 'Le mot de passe doit faire au moins 8 caractères.')
  login(pseudo.value.trim())
}
</script>

<template>
  <section class="panel narrow">
    <h1>{{ mode === 'login' ? 'Se connecter' : 'Créer un compte' }}</h1>
    <form class="stack" @submit.prevent="submit">
      <label class="field"><span>Pseudo</span><input v-model="pseudo" autocomplete="username" /></label>
      <label class="field">
        <span>Mot de passe</span>
        <input v-model="pass" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" />
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button class="btn primary">{{ mode === 'login' ? 'Se connecter' : 'Créer mon compte' }}</button>
    </form>
    <p class="muted" style="margin-top:1rem">
      {{ mode === 'login' ? 'Pas encore de compte ?' : 'Déjà un compte ?' }}
      <button class="btn link" @click="mode = mode === 'login' ? 'register' : 'login'">
        {{ mode === 'login' ? 'Créer un compte' : 'Se connecter' }}
      </button>
    </p>
  </section>
</template>
