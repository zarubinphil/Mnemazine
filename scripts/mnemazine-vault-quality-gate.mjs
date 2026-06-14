#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.MNEMAZINE_ROOT || path.resolve(process.cwd())
const argv = process.argv.slice(2)

function arg(name, fallback = '') {
  const hit = argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : argv[argv.indexOf(hit) + 1] || fallback
}

const VAULT = path.resolve(arg('vault', process.env.MNEMAZINE_VAULT || path.join(ROOT, 'vault')))

const badMarkers = [
  /raw\s+ocr/i,
  /сырой\s+ocr/i,
  /распознанный\s+текст\s+без\s+обработки/i,
  /lorem ipsum/i,
  /TODO:\s*rewrite/i,
  /скриншот\s+без\s+контекста/i
]

async function walk(dir) {
  const out = []
  for (const item of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, item.name)
    if (item.isDirectory()) out.push(...await walk(p))
    else if (item.isFile() && p.endsWith('.md')) out.push(p)
  }
  return out
}

const files = await walk(VAULT)
const failures = []
for (const file of files) {
  const text = await fs.readFile(file, 'utf8')
  const hit = badMarkers.find(re => re.test(text))
  const hasSource = /## Source|## Источник|source:/i.test(text)
  const hasMeaning = /## What This Is|## Что это|## Суть/i.test(text)
  if (hit || !hasSource || !hasMeaning) {
    failures.push({ file: path.relative(VAULT, file), marker: hit ? String(hit) : 'missing required sections' })
  }
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2))
  process.exit(1)
}

console.log(JSON.stringify({ ok: true, checked: files.length }, null, 2))
