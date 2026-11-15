// Renders status.json (built every few minutes by the workflow). Everything
// that comes from an issue is text: escaped, never parsed as HTML.
const API = 'https://api.hananime.fun'
const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const TZ = { timeZone: 'Asia/Jakarta' }
const time = (iso) => new Date(iso).toLocaleTimeString('id-ID', { ...TZ, hour: '2-digit', minute: '2-digit' }).replace('.', ':')
const date = (iso) => new Date(iso).toLocaleDateString('id-ID', { ...TZ, day: 'numeric', month: 'short' })
const dayLabel = (day) => new Date(day + 'T12:00:00+07:00').toLocaleDateString('id-ID', { ...TZ, day: 'numeric', month: 'short' })
const STEP = { investigating: 'Investigating', identified: 'Identified', monitoring: 'Monitoring', resolved: 'Resolved', update: 'Update', scheduled: 'Scheduled', 'in progress': 'In progress', completed: 'Completed' }

function ago(iso) {
  if (!iso) return 'belum pernah dicek'
  const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000))
  return m < 1 ? 'dicek barusan' : m < 60 ? `dicek ${m} menit lalu` : `dicek ${Math.round(m / 60)} jam lalu`
}

function duration(a, b) {
  const m = Math.max(1, Math.round((new Date(b) - new Date(a)) / 60000))
  const h = Math.floor(m / 60)
  return h ? `${h} jam${m % 60 ? ` ${m % 60} menit` : ''}` : `${m} menit`
}

function window_(m) {
  if (!m.start) return ''
  const d = new Date(m.start).toLocaleDateString('id-ID', { ...TZ, weekday: 'short', day: 'numeric', month: 'short' })
  return `${d}, ${time(m.start)}${m.end ? `–${time(m.end)}` : ''} WIB`
}

function verdict(s) {
  const names = (ids) => ids.map((id) => s.components.find((c) => c.id === id)?.name).filter(Boolean)
  const down = s.components.filter((c) => c.now === 'major' || c.now === 'minor')
  const maintNow = s.maintenance.find((m) => m.status === 'in progress')
  const maintNext = s.maintenance.find((m) => m.status === 'scheduled' && new Date(m.start) - Date.now() < 48 * 3600e3)
  const checked = ago(s.lastCheck)
  if (down.length) {
    const first = s.active[0]
    const subject = down.length === 1 ? esc(down[0].name) : 'Beberapa layanan'
    return {
      cls: 'state-incident', jp: '障害発生中',
      title: `${subject} <em>sedang ${down.every((c) => c.now === 'minor') ? 'melambat' : 'terganggu'}</em>.`,
      meta: [first ? `sejak ${time(first.start)} WIB` : null, checked, down.length < s.components.length ? 'komponen lain normal' : null],
    }
  }
  if (maintNow) return { cls: 'state-maint', jp: 'メンテナンス中', title: `Sedang <em>maintenance</em>.`, meta: [window_(maintNow), checked] }
  if (maintNext) return { cls: 'state-maint', jp: 'メンテナンス予定', title: `Semua normal, <em>maintenance ${new Date(maintNext.start).toDateString() === new Date().toDateString() ? 'hari ini' : 'segera'}</em>.`, meta: [window_(maintNext), checked] }
  const up = s.components.map((c) => c.uptime).filter((u) => u != null)
  const avg = up.length ? up.reduce((a, b) => a + b, 0) / up.length : null
  return { cls: 'state-ok', jp: '稼働状況', title: 'Semua layanan <em>berjalan normal</em>.', meta: [checked, `pengecekan tiap ${s.intervalMinutes} menit`, avg != null ? `uptime 90 hari ${avg.toFixed(2).replace('.', ',')}%` : null] }
}

const log = (updates) => `<ul class="log">${updates.map((u) => `<li><time>${time(u.at)}</time><div><b>${esc(STEP[u.status] || u.status)}</b><p>${esc(u.text)}</p></div></li>`).join('')}</ul>`

function affects(i, s) {
  const names = i.components.map((id) => s.components.find((c) => c.id === id)?.name).filter(Boolean)
  return names.length ? `Berdampak ke ${esc(names.join(', '))}.` : ''
}

function render(s) {
  const v = verdict(s)
  $('app').className = 'wrap ' + v.cls
  $('verdict').innerHTML = `<div class="jp">${v.jp}</div><h1>${v.title}</h1><div class="meta">${v.meta.filter(Boolean).map((m) => `<span>${esc(m)}</span>`).join('')}</div>`

  const live = [...s.active, ...s.maintenance]
  $('now').hidden = !live.length
  $('now').innerHTML = live.length ? `<div class="eyebrow"><span>${s.active.length ? 'Sedang ditangani' : 'Terjadwal'}</span></div>` + live.map((i) => {
    const badge = i.kind === 'maintenance' ? ['b-warn', STEP[i.status]] : ['b-red', STEP[i.status] || 'Investigating']
    return `<div class="live" style="margin-top:12px"><div class="live-head"><div><h2>${esc(i.title)}</h2><div class="affects">${i.kind === 'maintenance' ? esc(window_(i)) + '. ' : ''}${affects(i, s)}</div></div>
      <span class="badge ${badge[0]}">${esc(badge[1])}</span></div>${log(i.updates)}</div>`
  }).join('') : ''

  $('comps').innerHTML = s.components.map((c) => {
    const state = c.now === 'major' ? '<span class="s-bad">Terganggu</span>' : c.now === 'minor' ? '<span class="s-warn">Melambat</span>' : c.now === 'maintenance' ? '<span class="s-warn">Maintenance</span>' : '<span class="s-ok">Normal</span>'
    const up = c.uptime == null ? '' : ` <span style="color:var(--ink-400)">· ${c.uptime.toFixed(2).replace('.', ',')}%</span>`
    const cells = c.strip.map((d, k) => `<i class="${d.level}" data-c="${esc(c.id)}" data-k="${k}"></i>`).join('')
    return `<div class="comp"><div class="comp-head"><div><span class="comp-name">${esc(c.name)}</span><span class="comp-sub">${esc(c.sub)}</span></div>
      <div class="comp-state">${state}${up}</div></div><div class="strip">${cells}<div class="tip"></div></div></div>`
  }).join('')

  // History: the last 14 days, quiet stretches folded into one line.
  const byDay = new Map()
  for (const i of s.history) {
    const day = new Date(new Date(i.start || 0).getTime() + 7 * 3600e3).toISOString().slice(0, 10)
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push(i)
  }
  const rows = []
  let quiet = []
  const flush = () => {
    if (!quiet.length) return
    const a = quiet.at(-1), b = quiet[0]
    const label = quiet.length === 1 ? (b.today ? 'Hari ini' : dayLabel(b.day)) : `${dayLabel(a.day)} – ${b.today ? 'hari ini' : dayLabel(b.day)}`
    rows.push(`<div class="day"><time>${label}</time><div><span class="quiet">Tidak ada insiden${quiet.length > 1 ? ` selama ${quiet.length} hari` : ''}.</span></div></div>`)
    quiet = []
  }
  for (let back = 0; back < 14; back++) {
    const day = new Date(Date.now() + 7 * 3600e3 - back * 86400e3).toISOString().slice(0, 10)
    const items = byDay.get(day) || []
    if (!items.length) { quiet.push({ day, today: back === 0 }); continue }
    flush()
    rows.push(`<div class="day"><time>${back === 0 ? 'Hari ini' : dayLabel(day)}</time><div>${items.map((i) => {
      const meta = i.open ? `Sedang ditangani · sejak ${time(i.start)}` : `Selesai · ${i.end ? duration(i.start, i.end) : ''}`
      const names = i.components.map((id) => s.components.find((c) => c.id === id)?.name).filter(Boolean).join(', ')
      return `<div class="inc"><details><summary style="list-style:none"><a>${esc(i.title)}</a><span class="mono">${esc(meta)}${names ? ' · ' + esc(names) : ''}</span></summary><div class="details">${log(i.updates)}</div></details></div>`
    }).join('')}</div></div>`)
  }
  flush()
  $('history').innerHTML = rows.join('')
  window.__status = s
}

document.addEventListener('mouseover', (e) => {
  const cell = e.target.closest('.strip i')
  if (!cell || !window.__status) return
  const strip = cell.parentElement, tip = strip.querySelector('.tip')
  const d = window.__status.components.find((c) => c.id === cell.dataset.c).strip[+cell.dataset.k]
  const label = d.level === 'none' ? 'Belum dipantau' : d.incidents ? d.incidents.join(', ') : d.down ? `Gagal dicek sekitar ${d.down} menit` : 'Tidak ada gangguan'
  tip.innerHTML = `<span class="mono">${esc(dayLabel(d.day))}${d.estimate ? ' · estimasi dari log server' : ''}</span><br>${esc(label)}`
  const r = strip.getBoundingClientRect(), c = cell.getBoundingClientRect()
  tip.style.left = Math.min(Math.max(c.left - r.left + c.width / 2, 90), r.width - 90) + 'px'
  tip.classList.add('on')
})
document.addEventListener('mouseout', (e) => { const s = e.target.closest('.strip'); if (s) s.querySelector('.tip').classList.remove('on') })

async function load() {
  try {
    const res = await fetch('status.json?t=' + Date.now(), { cache: 'no-store' })
    if (res.ok) render(await res.json())
  } catch { /* keep what is shown */ }
}
load()
setInterval(load, 60_000)

// Cloudflare Turnstile: the API checks the token with Cloudflare.
const TURNSTILE_KEY = '0x4AAAAAAFs41nwIGHkeOA4y'
let human = null, widget = null
window.onTurnstile = () => {
  widget = turnstile.render('#turnstile', {
    sitekey: TURNSTILE_KEY, theme: 'dark', size: 'flexible', language: 'id',
    callback: (t) => { human = t },
    'expired-callback': () => { human = null },
    'error-callback': () => { human = null },
  })
}

// Subscribing: the API mails a confirmation link (double opt-in).
$('sub').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = e.target.querySelector('button'), msg = $('sub-msg')
  const email = e.target.email.value.trim()
  if (!human) {
    msg.style.color = ''
    msg.textContent = 'Tunggu verifikasi di bawah selesai dulu.'
    return
  }
  btn.disabled = true
  msg.textContent = ''
  try {
    const res = await fetch(`${API}/v1/status/subscribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, token: human }) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || 'Gagal mendaftar. Coba lagi nanti.')
    msg.style.color = 'var(--ok)'
    msg.textContent = 'Cek email kamu untuk link konfirmasi.'
    e.target.reset()
  } catch (err) {
    msg.style.color = ''
    msg.textContent = err.message === 'Failed to fetch' ? 'Langganan sedang tidak bisa dihubungi. Coba lagi nanti.' : err.message
  } finally {
    btn.disabled = false
    // A token is good for one check: get a fresh one for the next try.
    human = null
    if (widget !== null) turnstile.reset(widget)
  }
})

// Back from the confirmation link.
{
  const q = new URLSearchParams(location.search).get('langganan')
  const text = { ok: ['Langganan aktif. Kamu akan menerima email saat ada gangguan.', 'var(--ok)'], kedaluwarsa: ['Link konfirmasi tidak valid atau sudah kedaluwarsa. Daftar ulang di atas.', ''], gagal: ['Konfirmasi gagal disimpan. Coba lagi nanti.', ''] }[q]
  if (text) {
    $('sub-msg').textContent = text[0]
    $('sub-msg').style.color = text[1]
    history.replaceState(null, '', location.pathname + '#langganan')
  }
}
