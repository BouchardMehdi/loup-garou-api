<script setup>
import { computed } from 'vue'

const props = defineProps({ phase: String, timeLeft: Number, total: Number })
const R = 34
const C = 2 * Math.PI * R
const offset = computed(() => C * (1 - Math.max(0, props.timeLeft) / props.total))
const clock = computed(() => {
  const t = Math.max(0, props.timeLeft)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
})
</script>

<template>
  <div class="phase">
    <div class="phase-disc" aria-hidden="true">
      <svg viewBox="0 0 80 80" class="ring">
        <circle cx="40" cy="40" :r="R" class="track" />
        <circle cx="40" cy="40" :r="R" class="bar" :stroke-dasharray="C" :stroke-dashoffset="offset" transform="rotate(-90 40 40)" />
      </svg>
      <div class="disc" :class="phase === 'night' ? 'moon' : 'sun'"></div>
    </div>
    <div class="time" role="timer">{{ clock }}</div>
  </div>
</template>
