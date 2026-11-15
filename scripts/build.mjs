// Builds ./_site: the static page plus status.json, from the check data
// (./data) and the incidents and maintenance kept as GitHub issues.
//
// Only issues and comments by the repository's owner, members,
// collaborators or the workflow's bot count: the repository is public and
// anyone may open an issue or comment, but nobody else writes on the page.
import { cpSync, rmSync, writeFileSync } from 'node:fs'
import { config, DATA, readJSON, writeJSON, dayKey, ghAll, REPO } from './lib.mjs'

const OUT = '_site'
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
const trusted = (x) => TRUSTED.has(x.author_association) || x.user?.login === 'github-actions[bot]'
const STEP = /^\s*(investigating|identified|monitoring|resolved|update|scheduled|in progress|completed)\s*[:\-–]\s*/i
const COMPONENT_IDS = new Set(config.components.map((c) => c.id))

const now = new Date()
const state = readJSON(`${DATA}/state.json`, {})
const daily = readJSON(`${DATA}/daily.json`, {})

const clean = (text) => (text || '').replace(/<!--[\s\S]*?-->/g, '').replace(/\r/g, '').trim()

// "Mulai: 2026-11-22 02:00" / "Selesai: …" in WIB.
function when(body, word) {
  const m = body.match(new RegExp(`^\\s*${word}\\s*:\\s*(\\d{4}-\\d{2}-\\d{2})[ T](\\d{2}:\\d{2})`, 'im'))
  return m ? new Date(`${m[1]}T${m[2]}:00+07:00`).toISOString() : null
}

function steps(issue, comments, maintenance) {
  const out = []
  const push = (raw, at, id) => {
    const text = clean(raw)
    const m = text.match(STEP)
    if (!m && out.length) return // plain comments are internal notes
    const status = m ? m[1].toLowerCase() : maintenance ? 'scheduled' : 'investigating'
    const body = (m ? text.slice(m[0].length) : text)
      .split('\n').filter((l) => !/^\s*(mulai|selesai)\s*:/i.test(l)).join('\n').trim()
    out.push({ id, status, at: out.length ? at : when(raw || '', 'mulai') || at, text: body })
  }
  push(issue.body, issue.created_at, `${issue.number}`)
  for (const c of comments) if (trusted(c)) push(c.body, c.created_at, `${issue.number}-${c.id}`)
  return out
}

async function loadIssues() {
  if (!process.env.GITHUB_TOKEN) return []
  const since = new Date(now.getTime() - config.historyDays * 86400e3).toISOString()
  const list = (await ghAll(`/repos/${REPO}/issues?state=all&since=${since}`))
    .filter((i) => !i.pull_request && trusted(i))
    .filter((i) => i.labels.some((l) => l.name === 'incident' || l.name === 'maintenance'))
  const out = []
  for (const issue of list) {
    const labels = issue.labels.map((l) => l.name)
    const maintenance = labels.includes('maintenance')
    const comments = issue.comments ? await ghAll(`/repos/${REPO}/issues/${issue.number}/comments`) : []
    const updates = steps(issue, comments, maintenance)
    // Mulai:/Selesai: in the body date an incident written after the fact.
    const start = when(issue.body || '', 'mulai') || (maintenance ? null : issue.created_at)
    const end = when(issue.body || '', 'selesai') || (maintenance ? null : issue.closed_at)
    let status = updates.at(-1)?.status || (maintenance ? 'scheduled' : 'investigating')
    if (issue.state === 'closed') status = maintenance ? 'completed' : 'resolved'
    else if (maintenance && start && end) status = now < new Date(start) ? 'scheduled' : now < new Date(end) ? 'in progress' : 'completed'
    out.push({
      number: issue.number,
      kind: maintenance ? 'maintenance' : 'incident',
      title: issue.title,
      severity: labels.includes('minor') ? 'minor' : 'major',
      components: labels.filter((l) => l.startsWith('komponen:')).map((l) => l.slice(9)).filter((id) => COMPONENT_IDS.has(id)),
      status,
      open: !['resolved', 'completed'].includes(status),
      start,
      end,
      updates: updates.reverse(),
      url: issue.html_url,
    })
  }
  return out.sort((a, b) => (b.start || '').localeCompare(a.start || ''))
}

const issues = await loadIssues()
const active = issues.filter((i) => i.kind === 'incident' && i.open)
const maintenance = issues.filter((i) => i.kind === 'maintenance' && i.open)

// The days an incident covered, for the strips (WIB days).
function daysOf(i) {
  const out = []
  const end = i.end ? new Date(i.end) : now
  for (let t = new Date(i.start); t <= end; t = new Date(t.getTime() + 86400e3)) out.push(dayKey(t))
  out.push(dayKey(end))
  return new Set(out)
}

const days = Array.from({ length: config.historyDays }, (_, k) => dayKey(new Date(now.getTime() - (config.historyDays - 1 - k) * 86400e3)))
const components = config.components.map((c) => {
  const mine = issues.filter((i) => i.kind === 'incident' && i.components.includes(c.id))
  const hit = mine.map((i) => ({ i, days: daysOf(i) }))
  let checks = 0, fails = 0
  const strip = days.map((day) => {
    const d = daily[c.id]?.[day]
    const cell = { day, checks: d?.checks || 0, down: (d?.fails || 0) * config.intervalMinutes }
    if (d?.estimate) cell.estimate = true
    checks += cell.checks
    fails += d?.fails || 0
    const on = hit.filter((h) => h.days.has(day)).map((h) => h.i)
    cell.level = !cell.checks && !on.length ? 'none'
      : on.some((i) => i.severity === 'major') || cell.down >= 30 ? 'major'
      : on.length || cell.down > 0 ? 'minor' : 'ok'
    if (on.length) cell.incidents = on.map((i) => i.title)
    return cell
  })
  const open = active.filter((i) => i.components.includes(c.id))
  const inMaint = maintenance.some((m) => m.status === 'in progress' && m.components.includes(c.id))
  const current = open.some((i) => i.severity === 'major') ? 'major' : open.length ? 'minor' : inMaint ? 'maintenance' : 'ok'
  return { id: c.id, name: c.name, sub: c.sub, now: current, uptime: checks ? 100 - (fails / checks) * 100 : null, strip }
})

const lastCheck = Object.values(state).map((s) => s.last?.at).filter(Boolean).sort().at(-1) || null
writeJSON(`${OUT}/status.json`, {
  generatedAt: now.toISOString(),
  lastCheck,
  intervalMinutes: config.intervalMinutes,
  components,
  active,
  maintenance,
  history: issues.filter((i) => !i.open || i.kind === 'incident'),
})

rmSync(`${OUT}/index.html`, { force: true })
cpSync('site', OUT, { recursive: true })
writeFileSync(`${OUT}/CNAME`, new URL(config.site).host + '\n')
console.log(`built: ${components.length} components, ${active.length} active, ${maintenance.length} maintenance, ${issues.length} issues`)
