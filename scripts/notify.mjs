// Emails every new incident or maintenance update to the subscribers
// (a Resend audience) as a broadcast. Runs after build.mjs; remembers what
// it sent in ./data/sent.json. Without RESEND_API_KEY and
// RESEND_AUDIENCE_ID it does nothing.
//
// The first run only records what already exists, so turning email on
// never mails the whole history.
import { readFileSync } from 'node:fs'
import { config, DATA, readJSON, writeJSON } from './lib.mjs'

const KEY = process.env.RESEND_API_KEY
const AUDIENCE = process.env.RESEND_AUDIENCE_ID
const FROM = process.env.RESEND_FROM || 'Hananime Status <status@hananime.fun>'
if (!KEY || !AUDIENCE) {
  console.log('notify: email not configured, skipped')
  process.exit(0)
}

const LABEL = {
  investigating: 'Sedang diperiksa', identified: 'Penyebab ditemukan', monitoring: 'Dipantau',
  resolved: 'Selesai', update: 'Update', scheduled: 'Maintenance terjadwal', 'in progress': 'Maintenance berjalan', completed: 'Maintenance selesai',
}

const status = JSON.parse(readFileSync('_site/status.json', 'utf8'))
const sentPath = `${DATA}/sent.json`
const sent = readJSON(sentPath, null)
const all = [...status.active, ...status.maintenance, ...status.history]
const seen = new Map()
for (const i of all) seen.set(i.number, i)

if (!sent) {
  writeJSON(sentPath, { ids: [...seen.values()].flatMap((i) => i.updates.map((u) => u.id)) })
  console.log('notify: first run, recorded existing updates without sending')
  process.exit(0)
}

const done = new Set(sent.ids)
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const at = (iso) => new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }) + ' WIB'

async function resend(path, body) {
  const res = await fetch(`https://api.resend.com${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Resend ${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

function html(i, u) {
  const names = i.components.map((id) => status.components.find((c) => c.id === id)?.name).filter(Boolean).join(', ')
  return `<!doctype html><html lang="id"><body style="margin:0;background:#f4f4f5;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:14px;">
<tr><td style="padding:28px;">
<p style="margin:0 0 6px;font:500 12px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:#71717a;">${esc(LABEL[u.status] || u.status)}</p>
<h1 style="margin:0 0 6px;font-size:20px;line-height:1.3;color:#111;">${esc(i.title)}</h1>
<p style="margin:0 0 18px;font-size:13px;color:#71717a;">${esc(names || 'Hananime')} · ${at(u.at)}</p>
<p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#27272a;white-space:pre-line;">${esc(u.text || '')}</p>
<a href="${config.site}" style="display:inline-block;padding:11px 18px;border-radius:10px;background:#e5484d;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">Lihat status</a>
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#a1a1aa;">Kamu menerima ini karena berlangganan update status Hananime. <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#a1a1aa;">Berhenti berlangganan</a></p>
</td></tr></table></body></html>`
}

let count = 0
for (const i of seen.values()) {
  for (const u of [...i.updates].reverse()) {
    if (done.has(u.id)) continue
    const subject = `[Hananime] ${LABEL[u.status] || u.status}: ${i.title}`
    const b = await resend('/broadcasts', { audience_id: AUDIENCE, from: FROM, subject, html: html(i, u), name: subject.slice(0, 120) })
    await resend(`/broadcasts/${b.id}/send`, {})
    done.add(u.id)
    count++
  }
}
writeJSON(sentPath, { ids: [...done] })
console.log(`notify: ${count} email update(s) sent`)
