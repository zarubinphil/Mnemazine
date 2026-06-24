#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { resolveVault } from './mnemazine-paths.mjs'

const ROOT = process.env.MNEMAZINE_ROOT || path.resolve(process.cwd())
const argv = process.argv.slice(2)

function arg(name, fallback = '') {
  const hit = argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : argv[argv.indexOf(hit) + 1] || fallback
}

const VAULT = resolveVault({ cli: arg('vault') })
const REQUIRE_DOSSIER = argv.includes('--require-dossier')
const CHANGED_SINCE = arg('changed-since', '')
const MAX_FAILURES = Number(arg('max-failures', process.env.MNEMAZINE_QUALITY_MAX_FAILURES || '0'))

function sinceMs(value) {
  if (!value) return 0
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value)
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const CHANGED_SINCE_MS = sinceMs(CHANGED_SINCE)

const badMarkers = [
  /raw\s+ocr/i,
  /сырой\s+ocr(?!\s+исключ[её]н)/i,
  /No extractable text/i,
  /Unextractable local source/i,
  /needs_manual_context/i,
  /распознанный\s+текст\s+без\s+обработки/i,
  /Video keyframe OCR/i,
  /Video transcript from local Whisper/i,
  /intake-draft/i,
  /draft-local/i,
  /локальное\s+извлечение/i,
  /local extraction only/i,
  /\btemp_image[_-]/i,
  /\bIMG_\d+/,
  /\.(WEBP|PNG|JPE?G|HEIC|TIFF)\b/,
  /lorem ipsum/i,
  /TODO:\s*rewrite/i,
  /скриншот\s+без\s+контекста/i
]

async function walk(dir) {
  const out = []
  for (const item of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, item.name)
    if (
      item.isDirectory() &&
      !['.git', '.obsidian'].includes(item.name) &&
      !item.name.startsWith('graphify-out')
    ) out.push(...await walk(p))
    else if (item.isFile() && p.endsWith('.md')) out.push(p)
  }
  return out
}

const files = await walk(VAULT)
const failures = []
let checked = 0
for (const file of files) {
  const stat = await fs.stat(file)
  if (CHANGED_SINCE_MS && stat.mtimeMs < CHANGED_SINCE_MS) continue
  const rel = path.relative(VAULT, file)
  if (
    rel.includes('/graphify-out/') ||
    rel.includes('/_legacy-index ') ||
    rel.includes('/_архив-дублей/') ||
    rel.includes('/Capabilities/_') ||
    /^99 Система\//.test(rel) ||
    /(^|\/)_(Содержание|МАСТЕР-ИНДЕКС|ROUTING|ШАБЛОНЫ)\.md$/.test(rel) ||
    ['AGENTS.md', 'CLAUDE.md', '_ROUTING.md', 'Лог обработки.md'].includes(rel)
  ) continue
  checked += 1
  const text = await fs.readFile(file, 'utf8')
  if (/^##\s+Атомизировано(?:\s|$)/m.test(text)) continue
  const hit = badMarkers.find(re => re.test(text))
  const hasSource = /#{2,}\s+(Source|Sources|Источник|Источники|Источники и подтверждения)(?:\s|$)|source:/i.test(text)
  const hasMeaning = /#{2,}\s+(What This Is|Что это|Что это и зачем|Суть|Полное объяснение)(?:\s|$)/i.test(text)
  const missingDossier = REQUIRE_DOSSIER
    ? [
        ['Короткий ответ', /^##\s+Короткий ответ(?:\s|$)/m],
        ['Полное объяснение', /^##\s+Полное объяснение(?:\s|$)/m],
        ['Как использовать', /^##\s+Как использовать(?:\s|$)/m],
        ['Ошибки и ограничения', /^##\s+Ошибки и ограничения(?:\s|$)/m],
        ['Достоверность', /^##\s+Достоверность(?:\s|$)/m],
        ['Атомизация', /^##\s+Атомизация(?:\s|$)/m],
      ].filter(([, re]) => !re.test(text)).map(([name]) => name)
    : []
  if (hit || !hasSource || !hasMeaning || missingDossier.length) {
    failures.push({ file: rel, marker: hit ? String(hit) : missingDossier.length ? `missing dossier sections: ${missingDossier.join(', ')}` : 'missing required sections' })
    if (MAX_FAILURES > 0 && failures.length >= MAX_FAILURES) break
  }
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, checked, total: files.length, scope: CHANGED_SINCE_MS ? { changed_since: new Date(CHANGED_SINCE_MS).toISOString() } : { changed_since: null }, failures }, null, 2))
  process.exit(1)
}

console.log(JSON.stringify({ ok: true, checked, total: files.length, scope: CHANGED_SINCE_MS ? { changed_since: new Date(CHANGED_SINCE_MS).toISOString() } : { changed_since: null } }, null, 2))
