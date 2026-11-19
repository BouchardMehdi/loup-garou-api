// État + faux serveur. Tout ce qui est ici sera remplacé par des appels
// à l'API REST et à Socket.IO de Mehdi, une fois les contrats figés.
import { reactive, computed } from 'vue'

export const ROLES = {
  villageois: { label: 'Villageois', text: 'Tu n’as pas de pouvoir. Observe, débats, vote.' },
  loup: { label: 'Loup-garou', text: 'Chaque nuit, les loups choisissent ensemble une victime.' },
  voyante: { label: 'Voyante', text: 'Chaque nuit, tu découvres le rôle d’un autre joueur vivant.' },
}
export const CHANNELS = { public: 'Village', wolves: 'Loups', dead: 'Morts', post: 'Après-partie' }
export const PHASES = { night: 'Nuit', debate: 'Débat', vote: 'Vote' }

const NAMES = ['Léa', 'Hugo', 'Inès', 'Tom', 'Camille', 'Noé', 'Manon', 'Lucas', 'Jade', 'Sacha', 'Zoé']
const LINES = [
  'Moi, je suis un simple villageois, promis.',
  'Qui a entendu du bruit cette nuit ?',
  '{n} est bien silencieux, non ?',
  'On ne vote pas au hasard cette fois.',
  'Je soupçonne {n}.',
]

export const state = reactive({
  screen: 'auth', // auth | lobbies | room | game | end
  user: null,
  lobbies: [
    { id: 1, name: 'Les veillées de Mehdi', players: 5 },
    { id: 2, name: 'Pleine lune', players: 8 },
    { id: 3, name: 'Débutants bienvenus', players: 3 },
  ],
  room: null,
  game: null,
  winner: null,
})

let timer = null
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const shuffle = (arr) => arr.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map((x) => x[1])
const fakes = (n) => NAMES.slice(0, n).map((name, i) => ({ id: i + 2, name }))
const defaults = () => ({ debate: 180, vote: 60, night: 60 })

/* ---------- compte ---------- */
export function login(name) {
  state.user = { id: 1, name }
  state.screen = 'lobbies'
}
export function logout() {
  clearInterval(timer)
  Object.assign(state, { user: null, room: null, game: null, winner: null, screen: 'auth' })
}

/* ---------- salons ---------- */
export function createRoom(name, isPrivate) {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase()
  state.room = { name, isPrivate, code, ownerId: 1, players: [{ id: 1, name: state.user.name }], settings: defaults() }
  state.screen = 'room'
}
export function joinLobby(l) {
  state.room = {
    name: l.name, isPrivate: false, code: null, ownerId: 2,
    players: [{ id: 1, name: state.user.name }, ...fakes(l.players - 1)], settings: defaults(),
  }
  state.screen = 'room'
}
export function joinByCode(code) {
  if (!/^[A-Z0-9]{6}$/i.test(code)) return false
  state.room = {
    name: 'Salon privé', isPrivate: true, code: code.toUpperCase(), ownerId: 2,
    players: [{ id: 1, name: state.user.name }, ...fakes(3)], settings: defaults(),
  }
  state.screen = 'room'
  return true
}
export function leaveRoom() {
  state.room = null
  state.screen = 'lobbies'
}
export function fillDemo() {
  const r = state.room
  r.players = [...r.players.slice(0, 1), ...fakes(7).map((p) => ({ ...p }))]
}
export function setDuration(key, el) {
  const v = Math.min(300, Math.max(30, Math.round(Number(el.value)) || 30))
  state.room.settings[key] = v
  el.value = v
}

/* ---------- partie ---------- */
export const me = computed(() => state.game?.players.find((p) => p.id === state.user.id))
const alive = () => state.game.players.filter((p) => p.alive)

export function startGame() {
  const r = state.room
  const n = r.players.length
  const wolves = n <= 7 ? 1 : n <= 10 ? 2 : 3
  const roles = shuffle([...Array(wolves).fill('loup'), 'voyante', ...Array(n - wolves - 1).fill('villageois')])
  state.game = {
    players: r.players.map((p, i) => ({ id: p.id, name: p.name, role: roles[i], alive: true })),
    settings: { ...r.settings },
    phase: 'night', night: 1, phaseId: 0,
    timeLeft: r.settings.night, total: r.settings.night,
    choice: null, validated: false, seen: {},
    chats: { public: [], wolves: [], dead: [], post: [] }, msgId: 0,
    channel: 'public', log: [],
  }
  state.winner = null
  state.screen = 'game'
  clearInterval(timer)
  timer = setInterval(() => {
    const g = state.game
    if (!g || g.phase === 'ended') return
    g.timeLeft--
    if (g.timeLeft <= 0) endPhase()
  }, 1000)
}

// Ce que le serveur laisserait voir : jamais le rôle des autres avant la fin.
export function visibleRole(p) {
  const g = state.game
  if (g.phase === 'ended') return p.role
  if (p.id === me.value.id) return p.role
  if (me.value.role === 'loup' && p.role === 'loup') return 'loup'
  if (me.value.role === 'voyante' && g.seen[p.id]) return g.seen[p.id]
  return null
}

export const pending = computed(() => {
  const g = state.game
  const m = me.value
  if (!g || g.phase === 'ended' || !m.alive) return null
  const others = alive().filter((p) => p.id !== m.id)
  if (g.phase === 'night' && m.role === 'loup')
    return { kind: 'wolves', title: 'Choisis la victime des loups', targets: others.filter((p) => p.role !== 'loup') }
  if (g.phase === 'night' && m.role === 'voyante') return { kind: 'seer', title: 'Choisis un joueur à sonder', targets: others }
  if (g.phase === 'vote') return { kind: 'vote', title: 'Vote pour éliminer un joueur', targets: others }
  return null
})

export function choose(id) {
  const g = state.game
  if (g.validated || !pending.value) return
  if (pending.value.targets.some((p) => p.id === id)) g.choice = id
}

export function validate(abstain = false) {
  const g = state.game
  const act = pending.value
  if (!act || g.validated) return
  if (abstain) g.choice = null
  g.validated = true
  if (act.kind === 'seer' && g.choice) {
    const t = g.players.find((p) => p.id === g.choice)
    g.seen[t.id] = t.role
    g.log.push({ private: true, text: `${t.name} est ${ROLES[t.role].label.toLowerCase()}.` })
  }
  // Tu es le seul acteur humain : la phase se ferme juste après ton choix.
  const id = g.phaseId
  setTimeout(() => { if (state.game === g && g.phaseId === id) endPhase() }, 1200)
}

const tally = (ids) => {
  const c = {}
  ids.forEach((t) => (c[t] = (c[t] || 0) + 1))
  const max = Math.max(0, ...Object.values(c))
  const top = Object.keys(c).filter((k) => c[k] === max)
  return max > 0 && top.length === 1 ? Number(top[0]) : null
}

function kill(id, text) {
  const g = state.game
  const p = g.players.find((x) => x.id === id)
  p.alive = false
  g.log.push({ text: text.replace('{n}', p.name) })
  if (p.id === me.value.id) g.channel = 'dead'
}

function resolveNight() {
  const g = state.game
  const m = me.value
  const prey = alive().filter((p) => p.role !== 'loup')
  const wolfAlive = alive().some((p) => p.role === 'loup')
  let target = null
  if (wolfAlive) {
    if (m.alive && m.role === 'loup') target = g.validated ? g.choice : null
    else target = pick(prey).id
  }
  if (target) kill(target, 'Au lever du jour, {n} n’est plus.')
  else g.log.push({ text: 'Au lever du jour, tout le monde est en vie.' })
}

function resolveVote() {
  const g = state.game
  const m = me.value
  const suspect = pick(alive()).id
  const votes = []
  alive().forEach((p) => {
    if (p.id === m.id) return
    const others = alive().filter((x) => x.id !== p.id)
    votes.push(Math.random() < 0.7 && suspect !== p.id ? suspect : pick(others).id)
  })
  if (m.alive && g.validated && g.choice) votes.push(g.choice)
  const out = tally(votes)
  if (out) kill(out, 'Le village a éliminé {n}.')
  else g.log.push({ text: 'Égalité ou aucune voix : personne n’est éliminé.' })
}

function winner() {
  const a = alive()
  const w = a.filter((p) => p.role === 'loup').length
  if (w === 0) return 'village'
  if (w >= a.length - w) return 'loups'
  return null
}

function finish() {
  const w = winner()
  if (!w) return false
  const g = state.game
  state.winner = w
  g.phase = 'ended'
  g.channel = 'post'
  clearInterval(timer)
  state.screen = 'end'
  return true
}

export function endPhase() {
  const g = state.game
  if (g.phase === 'ended') return
  if (g.phase === 'night') {
    resolveNight()
    if (finish()) return
    g.phase = 'debate'
    g.total = g.settings.debate
  } else if (g.phase === 'debate') {
    g.phase = 'vote'
    g.total = g.settings.vote
  } else {
    resolveVote()
    if (finish()) return
    g.night++
    g.phase = 'night'
    g.total = g.settings.night
  }
  g.timeLeft = g.total
  g.phaseId++
  g.choice = null
  g.validated = false
}

export function quitGame() {
  clearInterval(timer)
  Object.assign(state, { game: null, room: null, winner: null, screen: 'lobbies' })
}

/* ---------- chats : règles d'accès (le serveur les imposera pour de vrai) ---------- */
export function access(ch) {
  const g = state.game
  const m = me.value
  if (!g || !m) return { read: false, write: false }
  const ended = g.phase === 'ended'
  if (ch === 'post') return { read: ended, write: ended }
  const read = m.alive ? ch === 'public' || (ch === 'wolves' && m.role === 'loup') : ch === 'dead'
  return { read, write: read && !ended }
}
export const visibleChannels = computed(() => Object.keys(CHANNELS).filter((c) => access(c).read))

function push(ch, author, text, mine = false) {
  const g = state.game
  g.chats[ch].push({ id: ++g.msgId, author, text, mine })
}

export function sendMessage(ch, text) {
  const g = state.game
  if (!text.trim() || !access(ch).write) return
  push(ch, me.value.name, text.trim(), true)
  setTimeout(() => {
    if (state.game !== g) return
    const ended = g.phase === 'ended'
    const bots = g.players.filter((p) => {
      if (p.id === me.value.id) return false
      if (ended) return ch === 'post'
      if (!p.alive) return ch === 'dead'
      return ch === 'public' || (ch === 'wolves' && p.role === 'loup')
    })
    if (!bots.length) return
    const names = alive().map((p) => p.name)
    push(ch, pick(bots).name, pick(LINES).replace('{n}', pick(names)))
  }, 900)
}

/* ---------- outils de démo (à retirer quand l'API est branchée) ---------- */
export function devSetRole(role) {
  me.value.role = role
  state.game.choice = null
}
export function devToggleAlive() {
  const m = me.value
  m.alive = !m.alive
  state.game.channel = m.alive ? 'public' : 'dead'
}
