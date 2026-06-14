#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.MNEMAZINE_ROOT || path.resolve(process.cwd())
const VAULT = process.env.MNEMAZINE_VAULT || path.join(ROOT, 'vault')
const argv = process.argv.slice(2)

function arg(name, fallback = '') {
  const hit = argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : argv[argv.indexOf(hit) + 1] || fallback
}

const seed = arg('url')
const apply = argv.includes('--apply')
const graphify = argv.includes('--graphify')
const maxPages = Number(arg('max-pages', '40'))

if (!seed) {
  console.error('Usage: node scripts/mnemazine-ingest-site.mjs --url https://example.com [--apply] [--graphify] [--max-pages 40]')
  process.exit(2)
}

function escMd(s) {
  return String(s || '').replace(/\r/g, '').trim()
}

function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(h[1-4]|p|li|section|article|div)>/gi, '\n')
    .replace(/<h([1-4])[^>]*>/gi, '\n### ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function slug(value) {
  return String(value || 'site')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9а-я]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'site'
}

async function fetchText(url, optional = false) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Mnemazine/0.1 local knowledge ingest' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } catch (err) {
    if (optional) return ''
    throw err
  }
}

function links(html, base) {
  const out = new Set()
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1], base)
      if (u.origin === new URL(base).origin) out.add(u.href.replace(/#.*$/, ''))
    } catch {}
  }
  return [...out]
}

async function discover(seedUrl) {
  const origin = new URL(seedUrl).origin
  const urls = new Set([seedUrl])
  const robots = await fetchText(`${origin}/robots.txt`, true)
  const sitemaps = [...robots.matchAll(/Sitemap:\s*(\S+)/gi)].map(m => m[1])
  for (const sm of sitemaps.length ? sitemaps : [`${origin}/sitemap.xml`]) {
    const xml = await fetchText(sm, true)
    for (const m of xml.matchAll(/<loc>(.*?)<\/loc>/g)) {
      try {
        const u = new URL(m[1])
        if (u.origin === origin) urls.add(u.href)
      } catch {}
    }
  }
  if (urls.size === 1) {
    const html = await fetchText(seedUrl, true)
    links(html, seedUrl).forEach(u => urls.add(u))
  }
  return [...urls].slice(0, maxPages)
}

function pageNote(url, html) {
  const title = stripHtml(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || url)
  const text = stripHtml(html)
  const github = [...html.matchAll(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/g)].map(m => m[0])
  return `# ${title}

## What This Is

This note was created from a public web page and should be refined into smaller durable notes if it contains several topics.

## Source

- URL: ${url}

## Extracted Knowledge

${escMd(text.slice(0, 6000))}

## Public Repositories Mentioned

${github.length ? [...new Set(github)].map(u => `- ${u}`).join('\n') : '- None found on this page.'}

## Verification

- Status: extracted from public page
- Needs: human or agent review before treating as final operational knowledge
`
}

const urls = await discover(seed)
const outDir = path.join(ROOT, '.mnemazine/cache/site-ingest', slug(seed))
await fs.mkdir(outDir, { recursive: true })
const notes = []
for (const url of urls) {
  const html = await fetchText(url, true)
  if (!html.trim()) continue
  const note = pageNote(url, html)
  const file = `${new Date().toISOString().slice(0, 10)}-${slug(url)}.md`
  const target = apply ? path.join(VAULT, '01 Concepts', file) : path.join(outDir, file)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, note, 'utf8')
  notes.push(target)
}
if (graphify) {
  await import('node:child_process').then(({ spawnSync }) => spawnSync('graphify', ['update', VAULT], { stdio: 'inherit' }))
}
console.log(JSON.stringify({ seed, pages: urls.length, notes: notes.length, applied: apply, output: apply ? VAULT : outDir }, null, 2))
