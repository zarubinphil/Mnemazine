#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const ROOT = path.resolve(process.cwd())
const HELPER = path.join(ROOT, 'scripts', 'mnemazine-refresh-graphify.mjs')

function runNode(args, timeoutMs = 120000) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 5000).unref()
    }, timeoutMs)
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr, timedOut })
    })
    child.on('error', error => {
      clearTimeout(timer)
      resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}`, timedOut })
    })
  })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemazine-refresh-smoke-'))
const vault = path.join(tempRoot, 'vault')
await fs.mkdir(vault, { recursive: true })
await fs.writeFile(path.join(vault, 'sample.js'), 'export const answer = 42\n', 'utf8')
await fs.writeFile(path.join(vault, 'sample.md'), '# Sample\n\n## What This Is\n\nSmoke note.\n\n## Source\n\n- local\n', 'utf8')

const codeRun = await runNode([HELPER, '--vault', vault, '--mode', 'code', '--json'], 180000)
assert(codeRun.code === 2, `expected code mode exit 2 for pending semantic refresh, got ${codeRun.code}`)
const codeJson = JSON.parse(codeRun.stdout)
assert(codeJson.code_refresh?.ok === true, 'code refresh should be ok in code mode')
assert(codeJson.semantic_pending_after === true, 'code mode should leave semantic pending on docs corpus')

const unsupportedRun = await runNode([HELPER, '--vault', vault, '--mode', 'semantic', '--backend', 'fake', '--json'], 180000)
assert(unsupportedRun.code === 2, `expected semantic unsupported backend exit 2, got ${unsupportedRun.code}`)
const unsupportedJson = JSON.parse(unsupportedRun.stdout)
assert(unsupportedJson.semantic_refresh?.status === 'unsupported_backend', 'semantic mode should reject unsupported backend')

await fs.rm(tempRoot, { recursive: true, force: true })
console.log(JSON.stringify({
  ok: true,
  checks: [
    'code mode leaves semantic pending on docs corpus',
    'semantic mode rejects unsupported backend cleanly'
  ]
}, null, 2))
