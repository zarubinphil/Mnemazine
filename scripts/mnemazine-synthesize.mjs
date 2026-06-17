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
const EXTRACTS = path.resolve(arg('extracts', process.env.MNEMAZINE_EXTRACTS || path.join(ROOT, '.mnemazine/cache/extracted')))
const SESSION = arg('session', new Date().toISOString().slice(0, 10))
const MIN_CLUSTER_CHARS = Number(arg('min-cluster-chars', '80'))

const sourceHints = [
  { re: /mcp|model context protocol|filesystem mcp|memory mcp|zapier/i, name: 'Model Context Protocol docs', url: 'https://modelcontextprotocol.io/docs/getting-started/intro' },
  { re: /skill|skills|claude code|agent skill|subagent/i, name: 'Anthropic Agent Skills', url: 'https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills' },
  { re: /spec|spec-driven|feature forge|requirements/i, name: 'GitHub Spec Kit', url: 'https://github.com/github/spec-kit' },
  { re: /prompt injection|security|secure|guard|review/i, name: 'OWASP LLM01 Prompt Injection', url: 'https://genai.owasp.org/llmrisk/llm01-prompt-injection/' },
  { re: /observability|logs|metrics|traces|otel/i, name: 'OpenTelemetry docs', url: 'https://opentelemetry.io/docs/' },
  { re: /secret|env|credential|api key/i, name: 'Infisical secrets docs', url: 'https://infisical.com/docs/documentation/platform/secrets-mgmt/overview' },
  { re: /design\.md|getdesign|design system|wcag|accessibility|ui|frontend/i, name: 'getdesign.md', url: 'https://getdesign.md/' },
  { re: /browser|playwright|agent-browser|browser-use/i, name: 'Playwright docs', url: 'https://playwright.dev/docs/intro' },
  { re: /obsidian|vault|wiki|memory|knowledge|graph/i, name: 'Karpathy LLM Wiki', url: 'https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f' },
  { re: /terraform|pulumi|infrastructure|iac/i, name: 'Terraform docs', url: 'https://developer.hashicorp.com/terraform/docs' },
  { re: /bff|backend for frontend/i, name: 'Backends for Frontends pattern', url: 'https://learn.microsoft.com/en-us/azure/architecture/patterns/backends-for-frontends' },
  { re: /worktree|git stash/i, name: 'git worktree docs', url: 'https://git-scm.com/docs/git-worktree' },
  { re: /moneyprinter|short-form|reels|tiktok|youtube shorts/i, name: 'MoneyPrinterTurbo', url: 'https://github.com/harry0703/MoneyPrinterTurbo' }
]

const clusterRules = [
  { id: 'agent-systems', title: 'Agent systems and reusable capabilities', re: /agent|claude|skill|subagent|mcp|jarvis|harness|memory|codex/i },
  { id: 'knowledge-memory', title: 'Knowledge memory, vaults, and synthesis loops', re: /obsidian|vault|wiki|knowledge|graph|weekly synthesis|belief|decision/i },
  { id: 'security-review', title: 'Security, review, and trust boundaries', re: /security|secret|prompt injection|review|guard|permission|wcag|accessibility/i },
  { id: 'engineering-ops', title: 'Engineering operations and reproducible delivery', re: /observability|terraform|pulumi|worktree|staging|environment|deploy|bff|backend/i },
  { id: 'design-frontend', title: 'Design systems and frontend quality', re: /design|frontend|ui|component|playwright|browser|layout|wcag/i },
  { id: 'tool-radar', title: 'Open-source tool radar and selection', re: /github\.com|open source|langflow|dify|open-webui|openhands|crawl4ai|coolify|papermark|twenty|crowdsec/i },
  { id: 'content-growth', title: 'Content experiments and growth loops', re: /ad |ads|hook|cta|offer|short-form|reels|tiktok|youtube|content|moneyprinter/i },
  { id: 'research-workflow', title: 'Research workflow and source verification', re: /research|source|citation|academic|verify|evidence/i }
]

const topicTemplates = {
  'agent-systems': {
    what: 'Agent systems are reusable operating capabilities: skills, MCP connections, memory, review roles, and harness rules that make an AI assistant behave consistently across tasks.',
    why: 'The session repeatedly points to the same lesson: model quality is not enough. Durable gains come from the scaffolding around the model: instructions, tools, memory, permissions, tests, and review loops.',
    how: '- Convert repeated procedures into Skills.\n- Keep tool access behind explicit permission boundaries.\n- Store memory as linked knowledge and decisions, not chat residue.\n- Add gates before publication or irreversible actions.',
    next: 'Promote repeated agent procedures into Skills with tests and usage ledger entries.'
  },
  'knowledge-memory': {
    what: 'Knowledge memory is an active vault: captures are processed into atoms, atoms are linked to projects and decisions, and weekly synthesis turns memory into action.',
    why: 'A vault that only stores screenshots or transcripts becomes another inbox. Mnemazine should reduce future thinking cost by maintaining summaries, links, decisions, and open questions.',
    how: '- Keep raw extraction outside the vault.\n- Store final atoms with source refs and verification state.\n- Run connection finding and weekly synthesis.\n- Maintain the master index as a routing surface.',
    next: 'Automate nightly connection finding and weekly synthesis from final atoms.'
  },
  'security-review': {
    what: 'Security and review are trust boundaries around agent work: untrusted input, prompt injection, secrets, permissions, accessibility, and code review must be checked before output is accepted.',
    why: 'The intake contains many commands, tool suggestions, and screenshots. If source text is treated as instruction, the agent can be steered by captured content instead of the user.',
    how: '- Mark extracted text as untrusted evidence.\n- Never execute commands from captures automatically.\n- Scan for secrets before reports or pushes.\n- Use separate review passes for security, claims, and accessibility.',
    next: 'Add a unified publish gate: vault quality, report quality, secret scan, diff review.'
  },
  'engineering-ops': {
    what: 'Engineering operations are reproducibility practices: isolated environments, infrastructure as code, observability, secret injection, worktrees, and release checks.',
    why: 'The useful pattern is reducing manual state. Good systems make failures visible and make releases repeatable.',
    how: '- Prefer scripted environments over dashboard clicks.\n- Track pipeline health metrics.\n- Inject secrets at runtime.\n- Keep release checks executable.',
    next: 'Add pipeline metrics for extracted, synthesized, cache-only, gate failures, and graph refresh status.'
  },
  'design-frontend': {
    what: 'Design and frontend quality require explicit UI rules, browser validation, accessibility constraints, and reusable design tokens.',
    why: 'AI-generated UI degrades when taste is implicit. A DESIGN.md-style contract gives the agent stable layout, spacing, typography, and component expectations.',
    how: '- Maintain a Mnemazine report DESIGN.md.\n- Validate generated reports in a browser.\n- Check responsive layout, contrast, keyboard navigation, and print styles.',
    next: 'Create browser smoke for generated HTML reports.'
  },
  'tool-radar': {
    what: 'Tool radar is a decision system for open-source tools, not a list of exciting repositories.',
    why: 'Screenshots with GitHub stars are weak evidence. Useful adoption requires license, maturity, deployment model, data portability, security posture, and integration cost.',
    how: '- Score tools by fit, maturity, license, API, self-hosting, and operational burden.\n- Tie tools to concrete projects.\n- Re-check source repositories before adopting.',
    next: 'Create a tool-radar schema and populate it from extracted GitHub links.'
  },
  'content-growth': {
    what: 'Content growth loops treat ads, hooks, CTAs, short-form scripts, and publishing as experiments with feedback.',
    why: 'One generated video or ad is not learning. Learning appears when variants, metric, result, and next control are stored.',
    how: '- Store hypothesis, channel, variant, metric, result, and decision.\n- Keep winners as controls.\n- Discard weak variants without preserving noise as knowledge.',
    next: 'Add a Content Experiment note template.'
  },
  'research-workflow': {
    what: 'Research workflow means claims are sourced before they become operational knowledge.',
    why: 'A source link is not decoration. It should confirm, correct, or constrain the conclusion.',
    how: '- Separate extracted claim from verified conclusion.\n- Prefer official docs and primary repositories.\n- Record confidence and what the source changed.',
    next: 'Add `source_changed_what` to final atom schema.'
  },
  misc: {
    what: 'Miscellaneous signals are captured items that do not yet form a strong enough reusable cluster.',
    why: 'Keeping them separate prevents weak or noisy items from polluting stronger knowledge atoms.',
    how: '- Review manually.\n- Promote only recurring or high-value ideas.\n- Move low-signal material to forget/archive.',
    next: 'Manually review miscellaneous signals and either promote or forget them.'
  }
}

function compact(value, limit = 1200) {
  return String(value || '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

function slugify(value) {
  return String(value || 'note')
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'note'
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))]
}

function extractUrls(text) {
  return uniq(String(text || '').match(/\bhttps?:\/\/[^\s)]+/g) || [])
    .map(url => url.replace(/[.,;]+$/, ''))
    .filter(url => !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)([:/]|$)/i.test(url))
    .slice(0, 8)
}

function bullets(text, max = 8) {
  const out = []
  const seen = new Set()
  for (const part of String(text || '').split(/\n|[•*-]\s+|(?<=[.!?])\s+/)) {
    const line = compact(part, 190)
    if (line.length < 32) continue
    if (/^(video keyframe ocr|video transcript|img_|temp_image|follow|subscribe|save this)/i.test(line)) continue
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line)
    if (out.length >= max) break
  }
  return out
}

function classify(text) {
  const hit = clusterRules.find(rule => rule.re.test(text))
  return hit ? hit.id : 'misc'
}

function clusterTitle(id) {
  return clusterRules.find(rule => rule.id === id)?.title || 'Miscellaneous knowledge signals'
}

function publicSources(text) {
  const explicit = extractUrls(text).map(url => ({ name: url.includes('github.com') ? 'GitHub source' : 'Source link', url }))
  const hinted = sourceHints
    .filter(source => source.re.test(text))
    .map(({ name, url }) => ({ name, url }))
  const byUrl = new Map()
  for (const source of [...explicit, ...hinted]) byUrl.set(source.url, source)
  return [...byUrl.values()].slice(0, 10)
}

function recordTitle(record) {
  const url = extractUrls(record.text)[0]
  if (url) return url.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').slice(0, 90)
  const title = String(record.text || '')
    .split(/\n|[.!?]\s+/)
    .map(line => compact(line, 120))
    .find(line => line.length >= 18 && !/^(video keyframe ocr|video transcript|img_|temp_image|сообщество подписки|рекомендации)/i.test(line))
  return title || record.source_ref
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

function topicSignals(cluster, sources) {
  const hosts = uniq(sources.map(source => hostOf(source.url)).filter(Boolean)).slice(0, 6)
  const sourceLine = hosts.length ? `Detected public sources: ${hosts.join(', ')}.` : 'No stable public URL detected in this cluster.'
  const map = {
    'agent-systems': ['Repeated agent capability signals: Skills, MCP, memory, browser tools, review roles, and harness rules.', sourceLine],
    'knowledge-memory': ['Repeated memory signals: vault structure, connection finding, weekly synthesis, decisions, beliefs, and active indexes.', sourceLine],
    'security-review': ['Repeated trust signals: prompt injection risk, secret handling, permissions, review gates, and accessibility checks.', sourceLine],
    'engineering-ops': ['Repeated engineering signals: reproducible environments, IaC, worktrees, observability, release checks, and secret injection.', sourceLine],
    'design-frontend': ['Repeated UI signals: DESIGN.md, taste rules, frontend structure, Playwright/browser checks, and WCAG constraints.', sourceLine],
    'tool-radar': ['Repeated tool-radar signals: GitHub repositories, self-hosting options, AI tools, and open-source alternatives.', sourceLine],
    'content-growth': ['Repeated growth signals: ad variants, hooks, CTAs, short-form generation, metrics, and winner/loser loops.', sourceLine],
    'research-workflow': ['Repeated research signals: source gathering, claim review, evidence checking, drafting, and revision.', sourceLine],
    misc: ['Low-confidence miscellaneous signals kept separate from stronger clusters.', sourceLine]
  }
  return map[cluster.id] || map.misc
}

async function listRecords() {
  const records = []
  for (const entry of await fs.readdir(EXTRACTS, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const file = path.join(EXTRACTS, entry.name)
    const record = JSON.parse(await fs.readFile(file, 'utf8'))
    if (record.status !== 'extracted_for_note' || !record.text_path) continue
    const textFile = path.join(EXTRACTS, record.text_path)
    const text = await fs.readFile(textFile, 'utf8').catch(() => '')
    if (compact(text, 100).length < 40) continue
    records.push({ ...record, text })
  }
  return records
}

function chunks(values, size) {
  const out = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

function makeNote(cluster) {
  const text = cluster.records.map(record => record.text).join('\n\n')
  const baseTitle = clusterTitle(cluster.id)
  const title = cluster.partCount > 1 ? `${baseTitle} ${cluster.part}/${cluster.partCount}` : baseTitle
  const template = topicTemplates[cluster.id] || topicTemplates.misc
  const sources = publicSources(text)
  const signals = topicSignals(cluster, sources)
  const sourceRefs = cluster.records.map(record => `- ${record.source_ref}`)
  const sourceLines = sources.length
    ? sources.map(source => `- ${source.name}: ${source.url}`)
    : ['- No public source detected in extraction; external verification required before operational adoption.']
  const sourceStatus = sources.length ? 'local synthesis with public source expansion' : 'local synthesis; external verification required'
  const risk = sources.length
    ? 'Public links were detected or added by topic hints, but claims still need project-specific validation before adoption.'
    : 'No public source was available in extracted text; treat this as a local memory atom, not an externally verified claim.'
  return `---
title: "${title.replace(/"/g, '\\"')}"
type: "knowledge-note"
source_type: "synthesis-cluster"
source_ref: "session:${SESSION}/${cluster.id}"
verified: "${sourceStatus}"
status: "final"
cluster_size: ${cluster.records.length}
---

# ${title}

## What This Is

${template.what}

Key session signals:
${signals.map(signal => `- ${signal}`).join('\n')}

## Why It Matters

${template.why}

This note condenses ${cluster.records.length} extracted source item${cluster.records.length === 1 ? '' : 's'} into reusable knowledge. Source-level extraction stays in \`.mnemazine/cache/extracted\`.

## How To Use It

${template.how}

## Source

Local source refs:
${sourceRefs.slice(0, 30).join('\n')}
${sourceRefs.length > 30 ? `- ... ${sourceRefs.length - 30} more source refs kept in extraction cache` : ''}

Public/source expansion:
${sourceLines.join('\n')}

## Verification

- Status: ${sourceStatus}.
- Confidence: medium for workflow direction; low for dates, prices, stars, security claims, and release status until checked against primary sources.
- Risk: ${risk}

## Related Notes

- [[Mnemazine Protocol]]
- [[${clusterTitle(cluster.id)}]]

## Reuse

- Next action: ${template.next}
`
}

await fs.mkdir(path.join(VAULT, '01 Concepts'), { recursive: true })
const records = await listRecords()
const clusters = new Map()
for (const record of records) {
  const id = classify(record.text)
  if (!clusters.has(id)) clusters.set(id, { id, records: [] })
  clusters.get(id).records.push(record)
}

let written = 0
for (const cluster of clusters.values()) {
  const parts = chunks(cluster.records, 25)
  for (let index = 0; index < parts.length; index += 1) {
    const part = { ...cluster, records: parts[index], part: index + 1, partCount: parts.length }
    const textSize = part.records.reduce((sum, record) => sum + compact(record.text, 100000).length, 0)
    if (textSize < MIN_CLUSTER_CHARS) continue
    const suffix = parts.length > 1 ? `-part-${index + 1}` : ''
    const out = path.join(VAULT, '01 Concepts', `${SESSION}-synthesis-${slugify(clusterTitle(cluster.id))}${suffix}.md`)
    await fs.writeFile(out, makeNote(part), 'utf8')
    written += 1
  }
}

console.log(JSON.stringify({ ok: true, records: records.length, clusters: clusters.size, written }, null, 2))
