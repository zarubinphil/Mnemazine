#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { resolveVault } from './mnemazine-paths.mjs'

const ROOT = process.env.MNEMAZINE_ROOT || path.resolve(process.cwd())
const STATE = process.env.MNEMAZINE_STATE || path.join(ROOT, '.mnemazine/state')
const INBOX = process.env.MNEMAZINE_INBOX || path.join(ROOT, 'inbox')
const REPORTS = process.env.MNEMAZINE_REPORTS || path.join(ROOT, 'reports')
const JSON_OUT = process.argv.includes('--json')

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return fallback }
}

function run(name, command, args, env = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('close', code => resolve({
      name,
      ok: code === 0,
      code: code ?? 1,
      stdout: stdout.trim(),
      stderr: stderr.trim()
    }))
    child.on('error', error => resolve({
      name,
      ok: false,
      code: 1,
      stdout: stdout.trim(),
      stderr: `${stderr}\n${error.message}`.trim()
    }))
  })
}

async function activeInboxFiles(dir) {
  return (await fs.readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter(item => item.isFile() && !item.name.startsWith('.'))
    .map(item => item.name)
}

async function latestVisualReport() {
  const reports = []
  for (const item of await fs.readdir(REPORTS, { withFileTypes: true }).catch(() => [])) {
    if (!item.isFile() || !item.name.endsWith('.html') || !item.name.includes('visual-knowledge-report')) continue
    const file = path.join(REPORTS, item.name)
    reports.push({ file, mtimeMs: (await fs.stat(file)).mtimeMs })
  }
  return reports.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.file || ''
}

async function graphMarkers(vault) {
  const candidates = [
    path.join(ROOT, 'vault/graphify-out/needs_update'),
    path.join(vault, 'graphify-out/needs_update')
  ]
  const out = []
  for (const file of [...new Set(candidates.map(item => path.resolve(item)))]) {
    out.push({
      file,
      exists: existsSync(file),
      content: existsSync(file) ? (await fs.readFile(file, 'utf8')).trim() : ''
    })
  }
  return out
}

function tail(text, lines = 16) {
  return String(text || '').split('\n').slice(-lines).join('\n')
}

async function main() {
  const lastRun = await readJson(path.join(STATE, 'last-run.json'))
  const vault = resolveVault({ env: process.env.MNEMAZINE_VAULT || lastRun?.vault })
  const env = { MNEMAZINE_VAULT: vault }
  const report = await latestVisualReport()
  const since = lastRun?.started_at || ''

  const commands = [
    ['complete', 'npm', ['run', 'complete', '--', '--require-deep']],
    ...(report && since ? [['human-layer', 'npm', ['run', 'human-layer:quality', '--', '--changed-since', since, '--report', path.relative(ROOT, report)]]] : []),
    ['last-run', 'npm', ['run', 'last-run', '--', '--require-ok']],
    ['graph-smoke', 'npm', ['run', 'graph:smoke']],
    ['release-check', 'npm', ['run', 'release-check']]
  ]

  const results = []
  for (const [name, command, args] of commands) results.push(await run(name, command, args, env))
  const inbox = await activeInboxFiles(INBOX)
  const markers = await graphMarkers(vault)
  const failures = [
    ...results.filter(item => !item.ok).map(item => `${item.name} failed`),
    ...(inbox.length ? [`inbox not empty: ${inbox.length}`] : []),
    ...markers.filter(item => item.exists).map(item => `graph marker exists: ${item.file}`)
  ]

  const output = {
    ok: failures.length === 0,
    failures,
    vault,
    inbox: inbox.length,
    report: report ? path.relative(ROOT, report) : null,
    graph_markers: markers,
    commands: results.map(item => ({ name: item.name, ok: item.ok, code: item.code }))
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(output, null, 2))
  } else {
    console.log(output.ok ? 'Mnemazine doctor: ok' : 'Mnemazine doctor: failed')
    console.log(`Vault: ${vault}`)
    console.log(`Inbox: ${inbox.length}`)
    console.log(`Report: ${output.report || 'missing'}`)
    for (const item of results) console.log(`${item.ok ? 'ok' : 'fail'} ${item.name}`)
    for (const marker of markers) console.log(`${marker.exists ? 'fail' : 'ok'} marker ${marker.file}`)
    if (failures.length) {
      console.log('\nFailures:')
      for (const failure of failures) console.log(`- ${failure}`)
      const failed = results.find(item => !item.ok)
      if (failed) {
        console.log(`\n${failed.name} output:`)
        console.log(tail(failed.stderr || failed.stdout))
      }
    }
  }

  if (!output.ok) process.exit(1)
}

main().catch(error => {
  console.error(error.message || error)
  process.exit(1)
})
