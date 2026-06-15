#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const ROOT = process.env.MNEMAZINE_ROOT || path.resolve(process.cwd())
const INBOX = process.env.MNEMAZINE_INBOX || path.join(ROOT, 'inbox')
const VAULT = process.env.MNEMAZINE_VAULT || path.join(ROOT, 'vault')
const CACHE = path.join(ROOT, '.mnemazine/cache/processed-hashes.json')
const ARCHIVE = path.join(ROOT, '.mnemazine/archive')

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function sha256(file) {
  const hash = crypto.createHash('sha256')
  hash.update(await fs.readFile(file))
  return hash.digest('hex')
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return fallback }
}

function slugify(value) {
  return String(value || 'note')
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'note'
}

function compact(value, limit = 1400) {
  return String(value || '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

function sourceRef(hash) {
  return `local-media:${String(hash).slice(0, 16)}`
}

function inferTitle(text, fallback = 'Local source') {
  const clean = compact(text, 500)
  const url = clean.match(/\bhttps?:\/\/[^\s)]+/)?.[0]
  if (url) return url.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').slice(0, 90)
  const line = String(text || '')
    .split(/\n|[.!?]\s+/)
    .map(s => compact(s, 120))
    .find(s => s.length >= 18 && s.length <= 120 && !/^(IMG_|temp_image|screenshot|screen shot)/i.test(s))
  return line || fallback
}

function bullets(text, max = 7) {
  const out = []
  const seen = new Set()
  for (const part of String(text || '').split(/\n|[•*-]\s+/)) {
    const line = compact(part, 180)
    if (line.length < 24) continue
    if (/^(IMG_|temp_image|screenshot|screen shot|save this|follow)/i.test(line)) continue
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line)
    if (out.length >= max) break
  }
  return out
}

async function extract(file) {
  const ext = path.extname(file).toLowerCase()
  if (['.md', '.txt', '.json', '.csv'].includes(ext)) return await fs.readFile(file, 'utf8')
  const markitdown = spawnSync('markitdown', [file], { encoding: 'utf8' })
  if (markitdown.status === 0 && markitdown.stdout.trim()) return markitdown.stdout
  const ocr = path.join(ROOT, '.mnemazine/bin/vision-ocr')
  if (existsSync(ocr) && ['.png', '.jpg', '.jpeg', '.heic', '.webp', '.tiff'].includes(ext)) {
    const out = spawnSync(ocr, [file], { encoding: 'utf8' })
    if (out.status === 0) return out.stdout
  }
  return ''
}

function makeNote(source, hash, text) {
  const title = inferTitle(text, 'Unextractable local source')
  const facts = bullets(text)
  const summary = compact(text, 900) || 'No extractable text. Keep this as an unreadable source marker until manual context is added.'
  const ref = sourceRef(hash)
  const ext = path.extname(source).toLowerCase().replace('.', '') || 'file'
  return `---
title: "${title.replace(/"/g, '\\"')}"
type: "knowledge-note"
source_type: "${ext}"
source_ref: "${ref}"
source_hash: "${hash}"
verified: "local extraction only"
status: "final-local"
---

# ${title}

## What This Is

${summary}

## Why It Matters

This note converts an inbox item into durable knowledge without storing unprocessed extraction text, screenshot names, or copied fragments as the primary memory object.

## Key Points

${facts.length ? facts.map(item => `- ${item}`).join('\n') : '- Local extraction produced too little text. Add manual context or mark the source unreadable.'}

## How To Use It

- Treat this as a local-first knowledge seed.
- Verify current claims against official docs, GitHub, or primary sources before adopting tools or decisions.
- Split into smaller notes when the source contains unrelated ideas.

## Source

- ${ref}

## Verification

- Status: local extraction only.
- Evidence: SHA-256 source hash.
- Limitation: external facts, dates, prices, stars, and security claims are not confirmed by this run.

## Related Notes

- [[Mnemazine Protocol]]

## Reuse

- Turn stable procedures into skills.
- Turn repeated decisions into checklists.
- Link related notes after Graphify update.
`
}

async function archiveFile(file, hash) {
  const month = new Date().toISOString().slice(0, 7)
  const dir = path.join(ARCHIVE, month)
  await ensureDir(dir)
  const ext = path.extname(file)
  const target = path.join(dir, `${hash}${ext}`)
  await fs.rename(file, target)
  return target
}

async function main() {
  await ensureDir(INBOX)
  await ensureDir(VAULT)
  await ensureDir(path.dirname(CACHE))
  await ensureDir(ARCHIVE)
  const cache = await readJson(CACHE, {})
  const entries = (await fs.readdir(INBOX, { withFileTypes: true })).filter(d => d.isFile())
  let processed = 0
  const toArchive = []
  for (const entry of entries) {
    const file = path.join(INBOX, entry.name)
    const hash = await sha256(file)
    if (cache[hash]) continue
    const text = await extract(file)
    const title = inferTitle(text, 'Unextractable local source')
    const noteName = `${new Date().toISOString().slice(0, 10)}-${slugify(title)}.md`
    const notePath = path.join(VAULT, '01 Concepts', noteName)
    await ensureDir(path.dirname(notePath))
    await fs.writeFile(notePath, makeNote(file, hash, text), 'utf8')
    cache[hash] = path.relative(VAULT, notePath)
    toArchive.push({ file, hash })
    processed += 1
  }
  await fs.writeFile(CACHE, JSON.stringify(cache, null, 2), 'utf8')
  const quality = spawnSync(process.execPath, [path.join(ROOT, 'scripts/mnemazine-vault-quality-gate.mjs')], { stdio: 'inherit', env: process.env })
  if (quality.status !== 0) process.exit(quality.status || 1)
  const archived = []
  for (const item of toArchive) archived.push(await archiveFile(item.file, item.hash))
  if (spawnSync('graphify', ['--version'], { encoding: 'utf8' }).status === 0) {
    spawnSync('graphify', ['update', VAULT], { stdio: 'inherit' })
  }
  console.log(JSON.stringify({ inbox: entries.length, processed, archived: archived.length, vault: VAULT }, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
