<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { state, CHANNELS, visibleChannels, access, sendMessage } from '../store'

const draft = ref('')
const list = ref(null)
const g = computed(() => state.game)
const current = computed(() => (visibleChannels.value.includes(g.value.channel) ? g.value.channel : visibleChannels.value[0]))
const msgs = computed(() => g.value.chats[current.value] || [])
const canWrite = computed(() => access(current.value).write)

function send() {
  sendMessage(current.value, draft.value)
  draft.value = ''
}
watch(() => msgs.value.length, async () => {
  await nextTick()
  if (list.value) list.value.scrollTop = list.value.scrollHeight
})
</script>

<template>
  <section class="panel chat">
    <div class="tabs" role="tablist">
      <button v-for="c in visibleChannels" :key="c" class="tab" :class="{ on: c === current }" role="tab" @click="g.channel = c">
        {{ CHANNELS[c] }}
      </button>
    </div>
    <div ref="list" class="msgs" aria-live="polite">
      <p v-if="!msgs.length" class="muted">Aucun message pour l’instant.</p>
      <p v-for="m in msgs" :key="m.id" class="msg" :class="{ mine: m.mine }"><b>{{ m.author }}</b>{{ m.text }}</p>
    </div>
    <div class="row" style="margin-top:.75rem">
      <input v-model="draft" class="grow" :disabled="!canWrite" :placeholder="canWrite ? 'Écris un message' : 'Lecture seule'" maxlength="500" @keyup.enter="send" />
      <button class="btn primary" :disabled="!canWrite" @click="send">Envoyer</button>
    </div>
  </section>
</template>
