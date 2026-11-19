<script setup>
import { computed } from 'vue'
import { state, me, pending, ROLES, PHASES, visibleRole, choose, validate, endPhase, devSetRole, devToggleAlive } from '../store'
import PhaseDisc from '../components/PhaseDisc.vue'
import ChatPanel from '../components/ChatPanel.vue'

const g = computed(() => state.game)
const title = computed(() => (g.value.phase === 'night' ? `Nuit ${g.value.night}` : `${PHASES[g.value.phase]} · jour ${g.value.night}`))
const status = computed(() => {
  if (!me.value.alive) return 'Tu es mort. Tu ne vois plus le village, seulement le chat des morts.'
  if (g.value.validated) return 'Choix enregistré. Il est définitif.'
  if (pending.value) return `${pending.value.title}, puis valide ou abstiens-toi.`
  if (g.value.phase === 'night') return 'Le village dort. Attends le lever du jour.'
  return 'Débats dans le chat du village. Le vote suit.'
})
const selectable = (p) => !!pending.value && !g.value.validated && pending.value.targets.some((t) => t.id === p.id)
</script>

<template>
  <div class="game">
    <div class="stack">
      <section class="panel">
        <div class="row between">
          <div>
            <h2>{{ title }}</h2>
            <p class="muted">{{ status }}</p>
          </div>
          <PhaseDisc :phase="g.phase" :time-left="g.timeLeft" :total="g.total" />
        </div>
      </section>

      <section class="panel">
        <h3>Ton rôle : {{ ROLES[me.role].label }}</h3>
        <p class="muted">{{ ROLES[me.role].text }}</p>
      </section>

      <section class="panel stack">
        <h3>Joueurs</h3>
        <div class="players">
          <button
            v-for="p in g.players" :key="p.id" class="p"
            :class="{ dead: !p.alive, selectable: selectable(p), picked: g.choice === p.id }"
            :disabled="!selectable(p)" @click="choose(p.id)"
          >
            <span class="name">{{ p.name }}</span>
            <small v-if="p.id === me.id">toi</small>
            <small v-else-if="!p.alive">mort</small>
            <small v-if="visibleRole(p) && p.id !== me.id">{{ ROLES[visibleRole(p)].label }}</small>
          </button>
        </div>
        <div v-if="pending && !g.validated" class="row">
          <button class="btn primary" :disabled="!g.choice" @click="validate()">Valider mon choix</button>
          <button class="btn" @click="validate(true)">M’abstenir</button>
        </div>
      </section>

      <section v-if="g.log.length" class="panel log">
        <h3>Journal</h3>
        <p v-for="(l, i) in g.log" :key="i" :class="{ private: l.private }">{{ l.text }}</p>
      </section>
    </div>

    <div>
      <ChatPanel />
      <div class="demo">
        <p class="muted">Démo (retire ça quand l’API est branchée)</p>
        <div class="row" style="margin-top:.5rem">
          <button class="btn" @click="endPhase">Passer la phase</button>
          <button class="btn" @click="devSetRole('villageois')">Villageois</button>
          <button class="btn" @click="devSetRole('loup')">Loup</button>
          <button class="btn" @click="devSetRole('voyante')">Voyante</button>
          <button class="btn" @click="devToggleAlive">{{ me.alive ? 'Me tuer' : 'Me ressusciter' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
