import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'))

// Data lives on the `data` branch, checked out at ./data by the workflow.
export const DATA = process.env.STATUS_DATA || 'data'

export function readJSON(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJSON(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 1) + '\n')
}

// UTC day key (the status page shows days in WIB; a day is 00:00–24:00 UTC+7).
export function dayKey(date = new Date()) {
  return new Date(date.getTime() + 7 * 3600e3).toISOString().slice(0, 10)
}

export const REPO = process.env.GITHUB_REPOSITORY || 'zidanaetrna/status-hananime'

export async function gh(path, { method = 'GET', body } = {}) {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN is not set')
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

// Every page of a GitHub list endpoint.
export async function ghAll(path) {
  const out = []
  for (let page = 1; page < 50; page++) {
    const sep = path.includes('?') ? '&' : '?'
    const items = await gh(`${path}${sep}per_page=100&page=${page}`)
    out.push(...items)
    if (items.length < 100) break
  }
  return out
}

export const wib = (iso) =>
  new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

// The labels incidents use; created once, quietly skipped when they exist.
export async function ensureLabels(components) {
  const want = [
    ['incident', 'e5484d', 'Gangguan yang tampil di status page'],
    ['maintenance', 'd99a3e', 'Maintenance terjadwal'],
    ['auto', '8b8b93', 'Dibuka dan ditutup otomatis oleh monitor'],
    ['major', 'a92d32', 'Gangguan berat'],
    ['minor', 'd99a3e', 'Gangguan ringan'],
    ...components.map((c) => [`komponen:${c.id}`, '2e2e33', c.name]),
  ]
  for (const [name, color, description] of want) {
    try {
      await gh(`/repos/${REPO}/labels`, { method: 'POST', body: { name, color, description } })
    } catch (err) {
      if (!String(err.message).includes(' 422 ')) throw err
    }
  }
}
