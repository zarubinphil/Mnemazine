#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const ROOT = path.resolve(process.cwd())

function run(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }))
    child.on('error', error => resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}` }))
  })
}

async function must(label, command, args, options = {}) {
  const result = await run(command, args, options)
  if (result.code !== 0) {
    throw new Error(`${label} failed\n$ ${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`.trim())
  }
  return result
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

async function listFiles(dir) {
  const out = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await listFiles(file))
    else out.push(file)
  }
  return out
}

async function checkSyntax() {
  const scripts = [
    'scripts/mnemazine-run.mjs',
    'scripts/mnemazine-vault-quality-gate.mjs',
    'scripts/mnemazine-refresh-graphify.mjs',
    'scripts/mnemazine-refresh-graphify-smoke.mjs',
    'scripts/mnemazine-weekly-brief-html.mjs',
    'scripts/mnemazine-release-check.mjs'
  ]
  for (const script of scripts) {
    if (existsSync(path.join(ROOT, script))) await must(`syntax:${script}`, process.execPath, ['--check', script])
  }
}

async function demoSmoke() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemazine-release-'))
  const inbox = path.join(temp, 'inbox')
  const vault = path.join(temp, 'vault')
  const scripts = path.join(temp, 'scripts')
  await fs.mkdir(inbox, { recursive: true })
  await fs.mkdir(vault, { recursive: true })
  await fs.mkdir(scripts, { recursive: true })
  await fs.copyFile(path.join(ROOT, 'demo/inbox/example-guide.md'), path.join(inbox, 'example-guide.md'))
  await fs.copyFile(path.join(ROOT, 'scripts/mnemazine-vault-quality-gate.mjs'), path.join(scripts, 'mnemazine-vault-quality-gate.mjs'))

  await must('demo intake smoke', process.execPath, ['scripts/mnemazine-run.mjs'], {
    env: {
      MNEMAZINE_ROOT: temp,
      MNEMAZINE_INBOX: inbox,
      MNEMAZINE_VAULT: vault
    }
  })

  const inboxFiles = await fs.readdir(inbox)
  if (inboxFiles.length !== 0) throw new Error(`demo smoke failed: inbox not empty (${inboxFiles.join(', ')})`)

  const notes = (await listFiles(vault))
    .filter(file => file.endsWith('.md'))
    .filter(file => !file.split(path.sep).includes('graphify-out'))
  if (notes.length !== 1) throw new Error(`demo smoke failed: expected 1 note, got ${notes.length}`)
  const note = await fs.readFile(notes[0], 'utf8')
  const forbidden = [/intake-draft/i, /draft-local/i, /\btemp_image/i, /\bIMG_\d+/, /\.(WEBP|PNG|JPE?G|HEIC|TIFF)\b/]
  const hit = forbidden.find(re => re.test(note))
  if (hit) throw new Error(`demo smoke failed: raw marker in note (${hit})`)
  if (!/type:\s*"knowledge-note"/.test(note)) throw new Error('demo smoke failed: note is not knowledge-note')
  if (!/source_hash:/.test(note) || !/local-media:/.test(note)) throw new Error('demo smoke failed: provenance missing')

  const archived = (await listFiles(path.join(temp, '.mnemazine/archive'))).filter(file => file.endsWith('.md'))
  if (archived.length !== 1) throw new Error(`demo smoke failed: expected 1 archived source, got ${archived.length}`)
}

async function qualityAndPublicChecks() {
  await must('demo vault quality', 'npm', ['run', 'quality', '--', '--vault', 'demo/vault'])
  await must('public release scan', 'npm', ['run', 'public-check'])
}

async function repoMetadataCheck() {
  const pkg = await readJson(path.join(ROOT, 'package.json'))
  if (!pkg.description || !/[А-Яа-яЁё]/.test(pkg.description) || !/[A-Za-z]/.test(pkg.description)) {
    throw new Error('package description must be bilingual')
  }

  const readme = await fs.readFile(path.join(ROOT, 'README.md'), 'utf8')
  if (!readme.includes('https://github.com/zarubinphil/Mnemazine.git')) {
    throw new Error('README clone URL is stale or missing')
  }
  if (!readme.includes('**English:**') || !readme.includes('**Русский:**')) {
    throw new Error('README must include English and Russian descriptions')
  }
}

async function main() {
  const checks = [
    ['syntax', checkSyntax],
    ['demo-smoke', demoSmoke],
    ['quality-public', qualityAndPublicChecks],
    ['repo-metadata', repoMetadataCheck]
  ]
  const passed = []
  for (const [name, fn] of checks) {
    await fn()
    passed.push(name)
    console.log(`ok ${name}`)
  }
  console.log(JSON.stringify({ ok: true, passed }, null, 2))
}

main().catch(error => {
  console.error(error.message || error)
  process.exit(1)
})
