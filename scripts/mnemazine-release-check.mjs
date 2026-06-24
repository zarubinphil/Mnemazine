#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
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

function sha256Text(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
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
    'scripts/mnemazine-graph-utils.mjs',
    'scripts/mnemazine-repair-graphify-graph.mjs',
    'scripts/mnemazine-semantic-shards.mjs',
    'scripts/mnemazine-semantic-batches.mjs',
    'scripts/mnemazine-synthesize.mjs',
    'scripts/mnemazine-kb-search.mjs',
    'scripts/mnemazine-llm.mjs',
    'scripts/mnemazine-codex.mjs',
    'scripts/mnemazine-verify.mjs',
    'scripts/mnemazine-weekly-brief-html.mjs',
    'scripts/mnemazine-weekly-state.mjs',
    'scripts/mnemazine-postrun-knowledge-report.mjs',
    'scripts/mnemazine-digest.mjs',
    'scripts/mnemazine-report-quality-gate.mjs',
    'scripts/mnemazine-complete-check.mjs',
    'scripts/mnemazine-release-check.mjs'
  ]
  for (const script of scripts) {
    if (existsSync(path.join(ROOT, script))) await must(`syntax:${script}`, process.execPath, ['--check', script])
  }
  if (existsSync(path.join(ROOT, 'scripts/graphify-extract-limited.py'))) {
    await must('syntax:scripts/graphify-extract-limited.py', 'python3', ['-m', 'py_compile', 'scripts/graphify-extract-limited.py'])
  }
}

async function npmAuditCheck() {
  await must('npm audit', 'npm', ['audit', '--audit-level=moderate'])
}

async function desktopDryRunSmoke() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemazine-desktop-dry-'))
  const inbox = path.join(temp, 'live-inbox')
  const vault = path.join(temp, 'live-vault')
  await fs.mkdir(inbox, { recursive: true })
  await fs.mkdir(vault, { recursive: true })
  await fs.writeFile(path.join(inbox, 'live-source.md'), '# Live source\n\nMust stay in live inbox.\n', 'utf8')
  await must('desktop protocol dry-run', 'bash', ['scripts/mnemazine-desktop-protocol.sh', '--dry-run'], {
    env: {
      MNEMAZINE_INBOX: inbox,
      MNEMAZINE_VAULT: vault
    }
  })
  if (!existsSync(path.join(inbox, 'live-source.md'))) throw new Error('desktop dry-run smoke failed: live inbox file changed')
  const vaultFiles = await listFiles(vault)
  if (vaultFiles.length) throw new Error(`desktop dry-run smoke failed: live vault changed (${vaultFiles.join(', ')})`)
}

async function pollRetrySmoke() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemazine-poll-retry-'))
  const bin = path.join(temp, 'bin')
  const state = path.join(temp, 'state')
  await fs.mkdir(bin, { recursive: true })
  await fs.mkdir(state, { recursive: true })
  await fs.mkdir(path.join(temp, '.mnemazine'), { recursive: true })
  await fs.writeFile(path.join(temp, '.mnemazine', 'known_hosts'), 'example.test ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKpinnedHostKeyForReleaseSmokeOnly1234567890\n', 'utf8')
  await fs.writeFile(path.join(bin, 'ssh'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 })
  await fs.writeFile(path.join(bin, 'sync.sh'), `#!/usr/bin/env bash
set -euo pipefail
mkdir -p ${JSON.stringify(state)}
count_file=${JSON.stringify(path.join(state, 'count'))}
count="$(cat "$count_file" 2>/dev/null || echo 0)"
count=$((count + 1))
echo "$count" > "$count_file"
if [ -f ${JSON.stringify(path.join(state, 'fail'))} ]; then exit 1; fi
exit 0
`, { mode: 0o755 })
  await fs.writeFile(path.join(state, 'fail'), '1', 'utf8')
  const env = {
    MNEMAZINE_ROOT: temp,
    MNEMAZINE_VPS: 'deploy@example.test',
    MNEMAZINE_VPS_KEY: path.join(temp, 'missing-key'),
    MNEMAZINE_REMOTE_MUTATION: '1',
    MNEMAZINE_SSH_BIN: path.join(bin, 'ssh'),
    MNEMAZINE_TELEGRAM_SYNC_BIN: path.join(bin, 'sync.sh'),
    MNEMAZINE_POLL_TODAY: '2099-01-01',
    MNEMAZINE_POLL_HOUR: '9',
    MNEMAZINE_DAILY_RETRY_SECONDS: '60',
    MNEMAZINE_DAILY_MAX_ATTEMPTS: '2'
  }
  const first = await run('bash', ['scripts/mnemazine-telegram-poll.sh'], { env: { ...env, MNEMAZINE_POLL_EPOCH: '1000' } })
  if (first.code === 0) throw new Error('poll retry smoke failed: first failing sync passed')
  if (await fs.readFile(path.join(state, 'count'), 'utf8') !== '1\n') throw new Error('poll retry smoke failed: first attempt not counted')
  if (existsSync(path.join(temp, '.mnemazine', '.last-daily-completed'))) throw new Error('poll retry smoke failed: failure marked completed')

  await must('poll retry smoke:no early retry', 'bash', ['scripts/mnemazine-telegram-poll.sh'], { env: { ...env, MNEMAZINE_POLL_EPOCH: '1010' } })
  if (await fs.readFile(path.join(state, 'count'), 'utf8') !== '1\n') throw new Error('poll retry smoke failed: retried before backoff')

  await fs.unlink(path.join(state, 'fail'))
  await must('poll retry smoke:retry success', 'bash', ['scripts/mnemazine-telegram-poll.sh'], { env: { ...env, MNEMAZINE_POLL_EPOCH: '1061' } })
  if (await fs.readFile(path.join(state, 'count'), 'utf8') !== '2\n') throw new Error('poll retry smoke failed: retry did not run')
  const completed = await fs.readFile(path.join(temp, '.mnemazine', '.last-daily-completed'), 'utf8')
  if (completed.trim() !== '2099-01-01') throw new Error('poll retry smoke failed: success not marked completed')

  await must('poll retry smoke:no rerun after complete', 'bash', ['scripts/mnemazine-telegram-poll.sh'], { env: { ...env, MNEMAZINE_POLL_EPOCH: '2000' } })
  if (await fs.readFile(path.join(state, 'count'), 'utf8') !== '2\n') throw new Error('poll retry smoke failed: completed daily reran')
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
  await fs.writeFile(path.join(inbox, 'empty-source.bin'), '')
  await fs.copyFile(path.join(ROOT, 'scripts/mnemazine-vault-quality-gate.mjs'), path.join(scripts, 'mnemazine-vault-quality-gate.mjs'))
  await fs.copyFile(path.join(ROOT, 'scripts/mnemazine-synthesize.mjs'), path.join(scripts, 'mnemazine-synthesize.mjs'))
  await fs.copyFile(path.join(ROOT, 'scripts/mnemazine-llm.mjs'), path.join(scripts, 'mnemazine-llm.mjs'))
  await fs.copyFile(path.join(ROOT, 'scripts/mnemazine-codex.mjs'), path.join(scripts, 'mnemazine-codex.mjs'))
  await fs.copyFile(path.join(ROOT, 'scripts/mnemazine-verify.mjs'), path.join(scripts, 'mnemazine-verify.mjs'))

  await must('demo intake smoke', process.execPath, ['scripts/mnemazine-run.mjs'], {
    env: {
      MNEMAZINE_ROOT: temp,
      MNEMAZINE_INBOX: inbox,
      MNEMAZINE_VAULT: vault
    }
  })

  const inboxFiles = await fs.readdir(inbox)
  if (inboxFiles.length !== 1 || inboxFiles[0] !== 'empty-source.bin') {
    throw new Error(`demo smoke failed: expected only unextractable source in inbox (${inboxFiles.join(', ')})`)
  }

  const notes = (await listFiles(vault))
    .filter(file => file.endsWith('.md'))
    .filter(file => !file.split(path.sep).includes('graphify-out'))
  if (notes.length < 1) throw new Error(`demo smoke failed: expected synthesized notes, got ${notes.length}`)
  const forbidden = [/intake-draft/i, /draft-local/i, /\btemp_image/i, /\bIMG_\d+/, /\.(WEBP|PNG|JPE?G|HEIC|TIFF)\b/, /status:\s*"candidate"/i, /local extraction only/i]
  for (const noteFile of notes) {
    const note = await fs.readFile(noteFile, 'utf8')
    const hit = forbidden.find(re => re.test(note))
    if (hit) throw new Error(`demo smoke failed: raw marker in ${path.basename(noteFile)} (${hit})`)
    if (!/type:\s*"knowledge-note"/.test(note)) throw new Error(`demo smoke failed: ${path.basename(noteFile)} is not knowledge-note`)
    if (!/source_ref:\s*"session:/.test(note) || !/local-media:/.test(note)) throw new Error(`demo smoke failed: ${path.basename(noteFile)} synthesis provenance missing`)
  }

  const archived = await listFiles(path.join(temp, '.mnemazine/archive'))
  if (archived.length !== 1) throw new Error(`demo smoke failed: expected 1 archived finalized source, got ${archived.length}`)

  const extractRecords = (await listFiles(path.join(temp, '.mnemazine/cache/extracted'))).filter(file => file.endsWith('.json'))
  if (extractRecords.length !== 2) throw new Error(`demo smoke failed: expected 2 extract records, got ${extractRecords.length}`)
  const cache = await readJson(path.join(temp, '.mnemazine/cache/processed-hashes.json'))
  const cacheOnly = Object.values(cache).filter(value => value && typeof value === 'object' && value.status === 'needs_manual_context')
  if (cacheOnly.length !== 1) throw new Error(`demo smoke failed: expected 1 cache-only source, got ${cacheOnly.length}`)

  await fs.copyFile(path.join(ROOT, 'demo/inbox/example-guide.md'), path.join(inbox, 'cached-guide.md'))
  await must('demo cached-source archive smoke', process.execPath, ['scripts/mnemazine-run.mjs'], {
    env: {
      MNEMAZINE_ROOT: temp,
      MNEMAZINE_INBOX: inbox,
      MNEMAZINE_VAULT: vault
    }
  })
  const cachedInboxFiles = await fs.readdir(inbox)
  if (cachedInboxFiles.length !== 1 || cachedInboxFiles[0] !== 'empty-source.bin') {
    throw new Error(`demo cached smoke failed: expected only unextractable source in inbox (${cachedInboxFiles.join(', ')})`)
  }
  const archivedAfterCachedRun = await listFiles(path.join(temp, '.mnemazine/archive'))
  if (archivedAfterCachedRun.length !== 2) throw new Error(`demo cached smoke failed: expected 2 archived finalized sources, got ${archivedAfterCachedRun.length}`)
}

async function strictArchiveGateSmoke() {
  async function writeCachedCase(temp, noteBody) {
    const inbox = path.join(temp, 'inbox')
    const vault = path.join(temp, 'vault')
    const scripts = path.join(temp, 'scripts')
    const extracts = path.join(temp, '.mnemazine/cache/extracted')
    await fs.mkdir(inbox, { recursive: true })
    await fs.mkdir(path.join(vault, '01 Concepts'), { recursive: true })
    await fs.mkdir(scripts, { recursive: true })
    await fs.mkdir(extracts, { recursive: true })
    await fs.copyFile(path.join(ROOT, 'scripts/mnemazine-vault-quality-gate.mjs'), path.join(scripts, 'mnemazine-vault-quality-gate.mjs'))

    const source = 'MarkItDown converts Office/PDF/image inputs into Markdown for LLM pipelines. This cached source has enough text for synthesis.'
    const hash = sha256Text(source)
    const ref = `local-media:${hash.slice(0, 16)}`
    await fs.writeFile(path.join(inbox, 'source.md'), source, 'utf8')
    await fs.writeFile(path.join(extracts, `${hash}.txt`), source, 'utf8')
    await fs.writeFile(path.join(extracts, `${hash}.json`), JSON.stringify({ source_ref: ref, status: 'extracted_for_note', text_path: `${hash}.txt` }, null, 2), 'utf8')
    await fs.mkdir(path.join(temp, '.mnemazine/cache'), { recursive: true })
    await fs.writeFile(path.join(temp, '.mnemazine/cache/processed-hashes.json'), JSON.stringify({
      [hash]: { status: 'extracted_for_note', source_ref: ref, cache: `.mnemazine/cache/extracted/${hash}.json` }
    }, null, 2), 'utf8')
    await fs.writeFile(path.join(vault, '01 Concepts', 'cached-note.md'), noteBody(ref), 'utf8')
    return { inbox, vault, sourceFile: path.join(inbox, 'source.md') }
  }

  const weakTemp = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemazine-strict-weak-'))
  const weak = await writeCachedCase(weakTemp, ref => `---
title: "Weak cached note"
type: "knowledge-note"
verified: false
verification_status: "unknown"
status: "draft"
enrichment: "missing"
---

# Weak cached note

## What This Is

Cached OCR-like material, not final knowledge.

## Source

Local source refs:
- ${ref}

Public/source expansion:
- No public source detected.
`)
  const weakRun = await run(process.execPath, ['scripts/mnemazine-run.mjs'], {
    env: {
      MNEMAZINE_ROOT: weakTemp,
      MNEMAZINE_INBOX: weak.inbox,
      MNEMAZINE_VAULT: weak.vault,
      MNEMAZINE_DEEP: '1',
      MNEMAZINE_REQUIRE_DEEP: '1',
      MNEMAZINE_SYNTHESIZE: '0',
      MNEMAZINE_FINISH: '0'
    }
  })
  if (weakRun.code === 0) throw new Error('strict archive gate smoke failed: weak cached note passed')
  if (!existsSync(weak.sourceFile)) throw new Error('strict archive gate smoke failed: weak cached source was archived')

  const goodTemp = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemazine-strict-good-'))
  const good = await writeCachedCase(goodTemp, ref => `---
title: "Verified enriched cached note"
type: "knowledge-note"
verified: true
verification_status: "verified"
status: "final"
enrichment: "external-research"
---

# Verified enriched cached note

## What This Is

MarkItDown is verified here as reusable knowledge, not raw OCR.

## Source

Local source refs:
- ${ref}

Public/source expansion:
- Microsoft MarkItDown: https://github.com/microsoft/markitdown

## Enrichment

External facts added before atomization:
- Microsoft maintains MarkItDown as an open-source file-to-Markdown converter.
- The public repository documents optional extras for additional input formats.
`)
  await must('strict archive gate smoke:good', process.execPath, ['scripts/mnemazine-run.mjs'], {
    env: {
      MNEMAZINE_ROOT: goodTemp,
      MNEMAZINE_INBOX: good.inbox,
      MNEMAZINE_VAULT: good.vault,
      MNEMAZINE_DEEP: '1',
      MNEMAZINE_REQUIRE_DEEP: '1',
      MNEMAZINE_SYNTHESIZE: '0',
      MNEMAZINE_FINISH: '0'
    }
  })
  if (existsSync(good.sourceFile)) throw new Error('strict archive gate smoke failed: verified cached source stayed in inbox')
}

async function qualityAndPublicChecks() {
  await must('verify selftest', process.execPath, ['scripts/mnemazine-verify.mjs', '--selftest'])
  await must('webapp selftest', process.execPath, ['scripts/mnemazine-webapp-server.mjs', '--selftest'])
  await must('telegram bot selftest', process.execPath, ['scripts/mnemazine-telegram-bot.mjs', '--selftest'])
  await must('weekly state selftest', process.execPath, ['scripts/mnemazine-weekly-state.mjs', '--selftest'])
  await must('demo vault quality', 'npm', ['run', 'quality', '--', '--vault', 'demo/vault'])
  await reportQualityGateSmoke()
  await completeGateSmoke()
  await must('public release scan', 'npm', ['run', 'public-check'])
}

async function completeGateSmoke() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemazine-complete-gate-'))
  const inbox = path.join(temp, 'inbox')
  const reports = path.join(temp, 'reports')
  const state = path.join(temp, 'state')
  await fs.mkdir(inbox, { recursive: true })
  await fs.mkdir(reports, { recursive: true })
  await fs.mkdir(state, { recursive: true })
  await fs.writeFile(path.join(reports, 'complete-smoke.html'), [
    '<!doctype html><html><body>',
    '<main data-knowledge-atom="complete-smoke">',
    '<h1>Синтезированные знания</h1>',
    '<section><h2>Синтез</h2><p>Проверенная идея после обработки.</p></section>',
    '<section><h2>Источники</h2>',
    '<a href="https://example.com/source-a">source a</a>',
    '<a href="https://example.com/source-b">source b</a>',
    '<a href="https://example.com/source-c">source c</a></section>',
    '<section><h2>Где применить</h2><p>В пайплайне.</p></section>',
    '<section><h2>Проверка и риск</h2><p>Проверить источники.</p></section>',
    '<section><h2>Следующее действие</h2><p>Запустить gate.</p></section>',
    '</main></body></html>'
  ].join(''), 'utf8')
  await fs.writeFile(path.join(state, 'last-action-brief.md'), '# Complete Gate Smoke\n\n- Next action: keep release gate green.\n', 'utf8')
  await must('complete gate smoke', process.execPath, ['scripts/mnemazine-complete-check.mjs'], {
    env: {
      MNEMAZINE_VAULT: path.join(ROOT, 'demo/vault'),
      MNEMAZINE_INBOX: inbox,
      MNEMAZINE_REPORTS: reports,
      MNEMAZINE_STATE: state
    }
  })
}

async function reportQualityGateSmoke() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemazine-report-gate-'))
  const raw = path.join(temp, 'raw.html')
  const good = path.join(temp, 'good.html')
  await fs.writeFile(raw, [
    '<!doctype html><html><body>',
    '<article><h2>Video keyframe OCR</h2><p>IMG_1234.PNG raw OCR без синтеза.</p></article>',
    '</body></html>'
  ].join(''), 'utf8')
  await fs.writeFile(good, [
    '<!doctype html><html><body>',
    '<main data-knowledge-atom="demo">',
    '<h1>Синтезированные знания</h1>',
    '<section><h2>Синтез</h2><p>Проверенная идея после обработки.</p></section>',
    '<section><h2>Расширил источниками</h2>',
    '<a href="https://example.com/a">a</a>',
    '<a href="https://example.com/b">b</a>',
    '<a href="https://example.com/c">c</a></section>',
    '<section><h2>Где применить</h2><p>В пайплайне.</p></section>',
    '<section><h2>Проверка и риск</h2><p>Проверить источники.</p></section>',
    '<section><h2>Следующее действие</h2><p>Добавить тест.</p></section>',
    '</main></body></html>'
  ].join(''), 'utf8')

  const rawResult = await run(process.execPath, ['scripts/mnemazine-report-quality-gate.mjs', '--report', raw])
  if (rawResult.code === 0) throw new Error('report gate smoke failed: raw OCR report passed')

  await must('report quality gate smoke:good', process.execPath, ['scripts/mnemazine-report-quality-gate.mjs', '--report', good])
}

async function searchEvalSmoke() {
  // Tier A only (0 tokens): recall/anti-noise of the KB search skill. Tier B
  // (LLM judge) is opt-in via `npm run search:eval -- --deep`, not in the gate.
  await must('kb-search selftest', process.execPath, ['scripts/mnemazine-kb-search.mjs', '--selftest'])
  await must('kb-search eval (Tier A)', process.execPath, ['tests/search-eval.mjs'])
}

async function repoMetadataCheck() {
  const pkg = await readJson(path.join(ROOT, 'package.json'))
  if (!pkg.description || !/[А-Яа-яЁё]/.test(pkg.description) || !/[A-Za-z]/.test(pkg.description)) {
    throw new Error('package description must be bilingual')
  }

  // Bilingual READMEs as two files: README.md (English entry) + README.ru.md (Russian).
  const en = await fs.readFile(path.join(ROOT, 'README.md'), 'utf8')
  const ru = await fs.readFile(path.join(ROOT, 'README.ru.md'), 'utf8').catch(() => null)
  if (ru === null) throw new Error('README.ru.md is missing (Russian README required)')

  for (const [label, body] of [['README.md', en], ['README.ru.md', ru]]) {
    if (!body.includes('https://github.com/zarubinphil/Mnemazine.git')) {
      throw new Error(`${label} clone URL is stale or missing`)
    }
  }

  // Each version links to the other so readers can switch languages.
  if (!en.includes('README.ru.md')) throw new Error('README.md must link to README.ru.md')
  if (!ru.includes('README.md')) throw new Error('README.ru.md must link back to README.md')

  // Language sanity: English entry stays English-primary, Russian entry carries Cyrillic.
  if (!/[A-Za-z]/.test(en)) throw new Error('README.md must contain English text')
  if (!/[А-Яа-яЁё]/.test(ru)) throw new Error('README.ru.md must contain Russian text')

  // Section parity (drift guard): both versions must expose the same H2 sections.
  const h2 = body => (body.match(/^##\s+/gm) || []).length
  if (h2(en) !== h2(ru)) {
    throw new Error(`README section parity mismatch: README.md has ${h2(en)} H2, README.ru.md has ${h2(ru)}`)
  }
}

async function main() {
  const checks = [
    ['syntax', checkSyntax],
    ['npm-audit', npmAuditCheck],
    ['desktop-dry-run', desktopDryRunSmoke],
    ['poll-retry', pollRetrySmoke],
    ['demo-smoke', demoSmoke],
    ['strict-archive-gate', strictArchiveGateSmoke],
    ['quality-public', qualityAndPublicChecks],
    ['search-eval', searchEvalSmoke],
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
