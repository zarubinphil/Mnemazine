#!/usr/bin/env node
// Hybrid verification for synthesized notes (README:160 "verified, assumed, or
// still unknown"). Default = local, zero-network structural gate. Deep = opt-in
// network: HEAD reachability + a codex web cross-check of the claim.
// ponytail: local gate is deliberately structural (no HEAD by default) so the
// conservative pipeline never reaches the network. Reachability+LLM only on --deep.
import { codexAvailable, codexJson } from './mnemazine-codex.mjs'

// Local gate: a source URL present means the claim is at least anchored
// ("assumed"); none means we cannot back it at all ("unknown"). Never claims
// "verified" — only a real source check earns that.
export function verifyLocal(urls = []) {
  const has = (urls || []).filter(Boolean).length > 0
  return { status: has ? 'assumed' : 'unknown', checked: [], note: has ? 'source url present, not fetched' : 'no source url' }
}

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'evidence'],
  properties: {
    status: { type: 'string', enum: ['verified', 'assumed', 'unknown'] },
    evidence: { type: 'string' },
    checked: { type: 'array', items: { type: 'string' } }
  }
}

async function headOk(url, timeoutMs) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal }).catch(() => null)
    // Some servers reject HEAD — fall back to a ranged GET.
    if (!res || !res.ok) {
      res = await fetch(url, { method: 'GET', redirect: 'follow', headers: { Range: 'bytes=0-0' }, signal: ctrl.signal }).catch(() => null)
    }
    clearTimeout(t)
    return !!res && res.ok
  } catch { return false }
}

// Deep gate: confirm reachability, then ask codex (with its own web search) to
// judge whether the listed sources actually support the claim. Degrades to the
// local verdict if codex is unavailable or errors.
export async function verifyDeep(claim, urls = [], options = {}) {
  const timeoutMs = options.timeoutMs || 8000
  const live = []
  for (const url of (urls || []).filter(Boolean)) {
    if (await headOk(url, timeoutMs)) live.push(url)
  }
  if (!codexAvailable()) {
    const local = verifyLocal(live)
    return { ...local, checked: live, note: `codex unavailable; reachable=${live.length}` }
  }
  try {
    const prompt = `Verify whether the SOURCES below support the CLAIM. Use web search to check. Return status: "verified" only if a source clearly supports the claim, "assumed" if a source is relevant but does not clearly confirm it, "unknown" if no source supports it. Be strict.

CLAIM:
${String(claim).slice(0, 4000)}

SOURCES:
${live.length ? live.join('\n') : '(none reachable)'}`
    const res = await codexJson(prompt, VERIFY_SCHEMA, { timeoutMs: options.codexTimeoutMs })
    const status = ['verified', 'assumed', 'unknown'].includes(res?.status) ? res.status : 'unknown'
    return { status, checked: res?.checked?.length ? res.checked : live, evidence: res?.evidence || '', note: 'codex cross-check' }
  } catch (err) {
    const local = verifyLocal(live)
    return { ...local, checked: live, note: `deep verify failed: ${err.message}` }
  }
}

// Self-check: run `node scripts/mnemazine-verify.mjs --selftest`
if (process.argv.includes('--selftest')) {
  const a = verifyLocal(['https://x.test'])
  const b = verifyLocal([])
  if (a.status !== 'assumed') throw new Error('expected assumed for url present')
  if (b.status !== 'unknown') throw new Error('expected unknown for no url')
  console.log('verify selftest ok')
}
