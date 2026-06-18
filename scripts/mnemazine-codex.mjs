#!/usr/bin/env node
// Shared Codex bridge for Mnemazine node scripts.
// Reuses the headless `codex exec` pattern already proven in
// scripts/kb-enrich-codex.sh / kb-recheck-codex.sh — one schema-constrained
// call, JSON captured via `-o`, prompt on stdin. No new LLM client.
// ponytail: codex-only by design (Phil's local cascade). Swap the binary via
// MNEMAZINE_CODEX_BIN; wire another provider here only if codex stops being it.
import { spawnSync } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const CODEX = process.env.MNEMAZINE_CODEX_BIN || '/Applications/Codex.app/Contents/Resources/codex'
const TIMEOUT_MS = Number(process.env.MNEMAZINE_CODEX_TIMEOUT_MS || '300000')

export function codexAvailable() {
  return existsSync(CODEX)
}

// Run one schema-constrained codex call. Returns the parsed JSON object or
// throws. `cwd` is the codex working dir (defaults to a throwaway temp dir so
// codex never touches the repo). Caller owns the schema shape.
export async function codexJson(prompt, schema, options = {}) {
  if (!codexAvailable()) throw new Error(`codex binary not found: ${CODEX}`)
  const cwd = options.cwd || (await fs.mkdtemp(path.join(os.tmpdir(), 'mnemazine-codex-')))
  const stamp = crypto.randomBytes(6).toString('hex')
  const schemaFile = path.join(os.tmpdir(), `mnemazine-schema-${stamp}.json`)
  const outFile = path.join(os.tmpdir(), `mnemazine-codex-${stamp}.json`)
  const promptFile = path.join(os.tmpdir(), `mnemazine-prompt-${stamp}.md`)
  await fs.writeFile(schemaFile, JSON.stringify(schema), 'utf8')
  await fs.writeFile(promptFile, prompt, 'utf8')
  try {
    const res = spawnSync(CODEX, [
      'exec',
      '-C', cwd,
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      '--output-schema', schemaFile,
      '-o', outFile,
      '-'
    ], { input: await fs.readFile(promptFile, 'utf8'), encoding: 'utf8', timeout: options.timeoutMs || TIMEOUT_MS })
    if (res.status !== 0) {
      throw new Error(`codex exec failed (status ${res.status}): ${String(res.stderr || '').slice(-400)}`)
    }
    const raw = await fs.readFile(outFile, 'utf8').catch(() => '')
    if (!raw.trim()) throw new Error('codex returned empty output')
    return JSON.parse(raw)
  } finally {
    for (const f of [schemaFile, outFile, promptFile]) await fs.rm(f, { force: true }).catch(() => {})
  }
}
