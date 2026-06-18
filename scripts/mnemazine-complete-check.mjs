#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const ROOT = process.env.MNEMAZINE_ROOT || path.resolve(process.cwd())
const VAULT = process.env.MNEMAZINE_VAULT || path.join(ROOT, 'vault')
const INBOX = process.env.MNEMAZINE_INBOX || path.join(ROOT, 'inbox')
const REPORTS = process.env.MNEMAZINE_REPORTS || path.join(ROOT, 'reports')
const STATE = process.env.MNEMAZINE_STATE || path.join(ROOT, '.mnemazine/state')
const argv = process.argv.slice(2)

function arg(name, fallback = '') {
  const hit = argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : argv[argv.indexOf(hit) + 1] || fallback
}

const NEEDS_UPDATE_MAX_DAYS = Number(arg('needs-update-max-days', process.env.MNEMAZINE_NEEDS_UPDATE_MAX_DAYS || '1'))
const STRICT_GRAPH = argv.includes('--strict-graph')

function run(command, args) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('close', code => resolve({ ok: code === 0, code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() }))
    child.on('error', error => resolve({ ok: false, code: 1, stdout, stderr: `${stderr}\n${error.message}`.trim() }))
  })
}

async function newestFileMtime(dir, filter = () => true) {
  let newest = 0
  async function walk(folder) {
    for (const item of await fs.readdir(folder, { withFileTypes: true }).catch(() => [])) {
      if (item.name.startsWith('graphify-out')) continue
      const file = path.join(folder, item.name)
      if (item.isDirectory()) await walk(file)
      else if (item.isFile() && filter(file)) newest = Math.max(newest, (await fs.stat(file)).mtimeMs)
    }
  }
  await walk(dir)
  return newest
}

async function latestReport() {
  const reports = []
  for (const item of await fs.readdir(REPORTS, { withFileTypes: true }).catch(() => [])) {
    if (!item.isFile() || !item.name.endsWith('.html')) continue
    const file = path.join(REPORTS, item.name)
    reports.push({ file, mtimeMs: (await fs.stat(file)).mtimeMs })
  }
  return reports.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.file || ''
}

async function main() {
  const failures = []
  const warnings = []
  const inboxFiles = (await fs.readdir(INBOX).catch(() => [])).filter(name => !name.startsWith('.'))
  if (inboxFiles.length) failures.push(`inbox not empty: ${inboxFiles.length}`)

  const quality = await run(process.execPath, ['scripts/mnemazine-vault-quality-gate.mjs'])
  if (!quality.ok) failures.push(`vault quality failed: ${quality.stderr || quality.stdout}`)

  const report = await latestReport()
  if (!report) failures.push('weekly report missing')
  else {
    const reportQuality = await run(process.execPath, ['scripts/mnemazine-report-quality-gate.mjs', '--report', report])
    if (!reportQuality.ok) failures.push(`report quality failed: ${reportQuality.stderr || reportQuality.stdout}`)
  }

  const newestNote = await newestFileMtime(VAULT, file => file.endsWith('.md'))
  const reportMtime = report ? (await fs.stat(report)).mtimeMs : 0
  if (newestNote && reportMtime && reportMtime < newestNote) failures.push('weekly report older than newest vault note')

  const brief = path.join(STATE, 'last-action-brief.md')
  if (!existsSync(brief)) failures.push('action brief missing')
  else if ((await fs.stat(brief)).mtimeMs < newestNote) failures.push('action brief older than newest vault note')

  const needsUpdate = path.join(VAULT, 'graphify-out', 'needs_update')
  if (existsSync(needsUpdate)) {
    const ageDays = (Date.now() - (await fs.stat(needsUpdate)).mtimeMs) / 86400000
    const msg = `semantic graph pending (${ageDays.toFixed(2)} days)`
    if (STRICT_GRAPH || ageDays > NEEDS_UPDATE_MAX_DAYS) failures.push(msg)
    else warnings.push(msg)
  }

  const result = {
    ok: failures.length === 0,
    failures,
    warnings,
    inbox: inboxFiles.length,
    report: report ? path.relative(ROOT, report) : null,
    brief: existsSync(brief) ? path.relative(ROOT, brief) : null
  }
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}

main().catch(error => {
  console.error(error.message || error)
  process.exit(1)
})
