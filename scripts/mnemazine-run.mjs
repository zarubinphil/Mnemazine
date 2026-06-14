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
  const title = path.basename(source, path.extname(source)).replace(/[-_]+/g, ' ')
  const clean = text.replace(/\s+/g, ' ').trim()
  const summary = clean.slice(0, 1200) || 'No extractable text. Add manual context and rerun enrichment.'
  return `# ${title}

## What This Is

${summary}

## Why It Matters

This note was created from a raw inbox item. Review it, verify source claims, and split it into smaller atoms if it contains multiple topics.

## Source

- File: ${path.basename(source)}
- SHA-256: ${hash}

## Verification

- Status: needs review
- Evidence: local source file

## Reuse

- Turn stable procedures into skills.
- Turn repeated decisions into checklists.
- Link related notes after Graphify update.
`
}

async function main() {
  await ensureDir(INBOX)
  await ensureDir(VAULT)
  await ensureDir(path.dirname(CACHE))
  const cache = await readJson(CACHE, {})
  const entries = (await fs.readdir(INBOX, { withFileTypes: true })).filter(d => d.isFile())
  let processed = 0
  for (const entry of entries) {
    const file = path.join(INBOX, entry.name)
    const hash = await sha256(file)
    if (cache[hash]) continue
    const text = await extract(file)
    const noteName = `${new Date().toISOString().slice(0, 10)}-${slugify(entry.name)}.md`
    const notePath = path.join(VAULT, '01 Concepts', noteName)
    await ensureDir(path.dirname(notePath))
    await fs.writeFile(notePath, makeNote(file, hash, text), 'utf8')
    cache[hash] = path.relative(VAULT, notePath)
    processed += 1
  }
  await fs.writeFile(CACHE, JSON.stringify(cache, null, 2), 'utf8')
  spawnSync(process.execPath, [path.join(ROOT, 'scripts/mnemazine-vault-quality-gate.mjs')], { stdio: 'inherit', env: process.env })
  if (spawnSync('graphify', ['--version'], { encoding: 'utf8' }).status === 0) {
    spawnSync('graphify', ['update', VAULT], { stdio: 'inherit' })
  }
  console.log(JSON.stringify({ inbox: entries.length, processed, vault: VAULT }, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
