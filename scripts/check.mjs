// One monitoring pass: probe every component, record the result, and open
// or close automatic incidents (GitHub issues labelled `incident`, `auto`).
// Run every few minutes by the workflow; data lives in ./data.
import { config, DATA, readJSON, writeJSON, dayKey, gh, REPO, ensureLabels } from './lib.mjs'

const TIMEOUT = 15_000
const UA = 'status-hananime (+https://status.hananime.fun)'

async function get(url, opts = {}) {
  return fetch(url, { redirect: 'manual', ...opts, headers: { 'user-agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(TIMEOUT) })
}

async function json(url) {
  const res = await get(url)
  if (res.status !== 200) throw new Error(`${url} → ${res.status}`)
  const body = await res.json()
  return body?.data ?? body
}

// Each probe throws (with a short reason) when the component is not working.
const probes = {
  async web() {
    const res = await get(config.main + '/')
    if (res.status !== 200) throw new Error(`halaman utama ${res.status}`)
    if (!(await res.text()).includes('id="root"')) throw new Error('halaman utama tanpa aplikasi')
  },

  async api() {
    const d = await json(`${config.api}/v1/catalog/status`)
    if (!(d?.anime > 1000)) throw new Error(`katalog berisi ${d?.anime ?? 0} anime`)
  },

  // A recent episode has players, and /play opens one (a redirect to the file).
  async stream() {
    const latest = await json(`${config.api}/v1/latest`)
    const tried = []
    for (const item of (latest || []).slice(2, 10)) {
      const ep = (await json(`${config.api}/v1/episode/${encodeURIComponent(item.episode_slug)}`))?.episode
      const server = (ep?.servers || []).find((s) => s.kind === 'video')
      if (!server) continue
      const res = await get(`${config.api}/v1/play?u=${encodeURIComponent(server.url)}`)
      if (res.status === 302) return
      tried.push(res.status)
      if (tried.length >= 3) break
    }
    throw new Error(tried.length ? `pemutar gagal dibuka (${tried.join(', ')})` : 'tidak ada episode dengan server')
  },

  // Firebase answers, and our account endpoint turns a guest away (401, not 5xx).
  async auth() {
    const me = await get(`${config.api}/v1/auth/me`)
    if (me.status !== 401) throw new Error(`akun menjawab ${me.status}`)
    const fb = await get('https://hananime.fun/__/auth/handler')
    if (fb.status >= 500) throw new Error(`firebase ${fb.status}`)
  },

  async live() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(config.api.replace(/^http/, 'ws') + '/ws')
      const t = setTimeout(() => { ws.close(); reject(new Error('websocket tidak tersambung')) }, 10_000)
      ws.onopen = () => { clearTimeout(t); ws.close(); resolve() }
      ws.onerror = () => { clearTimeout(t); reject(new Error('websocket ditolak')) }
    })
  },
}

// A failure is only counted after a second try: one dropped request is noise.
async function probe(id) {
  const start = Date.now()
  try {
    await probes[id]()
    return { ok: true, ms: Date.now() - start }
  } catch {
    await new Promise((r) => setTimeout(r, 5000))
    try {
      await probes[id]()
      return { ok: true, ms: Date.now() - start }
    } catch (err) {
      return { ok: false, ms: Date.now() - start, error: String(err.message || err).slice(0, 200) }
    }
  }
}

const now = new Date()
const today = dayKey(now)
const state = readJSON(`${DATA}/state.json`, {})
const daily = readJSON(`${DATA}/daily.json`, {})
const results = Object.fromEntries(await Promise.all(config.components.map(async (c) => [c.id, await probe(c.id)])))

for (const c of config.components) {
  const r = results[c.id]
  const s = (state[c.id] ||= { fails: 0, passes: 0, incident: null })
  s.last = { at: now.toISOString(), ok: r.ok, ms: r.ms, error: r.error || null }
  if (r.ok) { s.passes++; s.fails = 0 } else { s.fails++; s.passes = 0 }

  const d = ((daily[c.id] ||= {})[today] ||= { checks: 0, fails: 0 })
  d.checks++
  if (!r.ok) d.fails++

  if (process.env.GITHUB_TOKEN) await incidents(c, s, r)
  console.log(`${c.id.padEnd(7)} ${r.ok ? 'ok  ' : 'FAIL'} ${String(r.ms).padStart(6)}ms ${r.error || ''}`)
}

// Keep the history window only.
const cutoff = dayKey(new Date(now.getTime() - (config.historyDays + 1) * 86400e3))
for (const id of Object.keys(daily)) for (const day of Object.keys(daily[id])) if (day < cutoff) delete daily[id][day]

writeJSON(`${DATA}/state.json`, state)
writeJSON(`${DATA}/daily.json`, daily)

async function incidents(c, s, r) {
  if (!r.ok && s.fails >= config.openAfterFails && !s.incident) {
    await ensureLabels(config.components)
    const minutes = s.fails * config.intervalMinutes
    const issue = await gh(`/repos/${REPO}/issues`, {
      method: 'POST',
      body: {
        title: `${c.name} sedang terganggu`,
        labels: ['incident', 'auto', 'major', `komponen:${c.id}`],
        body: `Investigating: Terdeteksi otomatis. ${c.name} gagal ${s.fails} kali berturut-turut (sekitar ${minutes} menit). Kami sedang memeriksanya.\n\n<!-- detail: ${r.error} -->`,
      },
    })
    s.incident = issue.number
  }
  if (r.ok && s.incident && s.passes >= config.closeAfterPasses) {
    const issue = await gh(`/repos/${REPO}/issues/${s.incident}`)
    if (issue.state === 'open' && issue.labels.some((l) => l.name === 'auto')) {
      await gh(`/repos/${REPO}/issues/${s.incident}/comments`, {
        method: 'POST',
        body: { body: `Resolved: ${c.name} sudah normal kembali.` },
      })
      await gh(`/repos/${REPO}/issues/${s.incident}`, { method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } })
    }
    s.incident = null
  }
}
