#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { resolveVault } from './mnemazine-paths.mjs'

const ROOT = process.env.MNEMAZINE_ROOT || path.resolve(process.cwd())
const argv = process.argv.slice(2)
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-')

function arg(name, fallback = '') {
  const hit = argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : argv[argv.indexOf(hit) + 1] || fallback
}

function flag(name) {
  return argv.includes(`--${name}`)
}

async function countVaultFiles(vault) {
  let count = 0
  async function walk(dir) {
    for (const item of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (item.name.startsWith('graphify-out')) continue
      const file = path.join(dir, item.name)
      if (item.isDirectory()) await walk(file)
      else if (item.isFile() && item.name.endsWith('.md')) count += 1
    }
  }
  await walk(vault)
  return count
}

function runWorker(job) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [
      'scripts/mnemazine-semantic-batches.mjs',
      '--vault', job.vault,
      '--graph', job.graph,
      '--batch-size', String(job.batchSize),
      '--excerpt-chars', String(job.excerptChars),
      '--max-tokens', String(job.maxTokens),
      '--start', String(job.start),
      '--limit', String(job.limit),
      '--no-cluster'
    ], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks = []
    const errors = []
    child.stdout.on('data', chunk => chunks.push(chunk))
    child.stderr.on('data', chunk => {
      errors.push(chunk)
      process.stderr.write(`[${job.name}] ${String(chunk)}`)
    })
    child.on('close', async code => {
      const stdout = Buffer.concat(chunks).toString()
      const stderr = Buffer.concat(errors).toString()
      await fs.writeFile(job.log, stdout + (stderr ? `\n--- stderr ---\n${stderr}` : ''), 'utf8')
      resolve({ ...job, code: code ?? 1 })
    })
    child.on('error', async error => {
      await fs.writeFile(job.log, error.message, 'utf8')
      resolve({ ...job, code: 1 })
    })
  })
}

async function main() {
  const vault = resolveVault({ cli: arg('vault') })
  const graph = path.resolve(arg('graph', path.join(vault, 'graphify-out/graph.json')))
  const shardsDir = path.resolve(arg('shards-dir', path.join(vault, `.mnemazine/semantic-shards/${RUN_ID}`)))
  const logsDir = path.resolve(arg('logs-dir', path.join(shardsDir, 'logs')))
  const manifestPath = path.join(shardsDir, 'manifest.json')
  const total = await countVaultFiles(vault)
  const start = Math.max(0, Number(arg('start', '0')))
  const limit = Number(arg('limit', String(Math.max(0, total - start))))
  const chunkSize = Math.max(1, Number(arg('chunk-size', '50')))
  const batchSize = Math.max(1, Number(arg('batch-size', '1')))
  const excerptChars = Math.max(300, Number(arg('excerpt-chars', '600')))
  const maxTokens = Math.max(120, Number(arg('max-tokens', '360')))
  const concurrency = Math.max(1, Number(arg('concurrency', String(Math.min(8, Math.max(1, os.cpus().length - 2))))))
  const dryRun = flag('dry-run')
  await fs.mkdir(shardsDir, { recursive: true })
  await fs.mkdir(logsDir, { recursive: true })

  const end = Math.min(total, start + limit)
  const jobs = []
  for (let i = start; i < end; i += chunkSize) {
    const size = Math.min(chunkSize, end - i)
    const name = `${String(i).padStart(5, '0')}-${String(i + size - 1).padStart(5, '0')}`
    jobs.push({
      name,
      vault,
      graph,
      shardGraph: path.join(shardsDir, `${name}.json`),
      log: path.join(logsDir, `${name}.log`),
      start: i,
      limit: size,
      batchSize,
      excerptChars,
      maxTokens
    })
  }

  if (dryRun) {
    console.log(JSON.stringify({ ok: true, dry_run: true, vault, graph, shards_dir: shardsDir, manifest: manifestPath, total, selected: limit, start, chunk_size: chunkSize, batch_size: batchSize, excerpt_chars: excerptChars, max_tokens: maxTokens, concurrency, jobs: jobs.map(j => ({ name: j.name, start: j.start, limit: j.limit, graph: j.shardGraph })) }, null, 2))
    return
  }

  await fs.writeFile(manifestPath, `${JSON.stringify({
    vault,
    graph,
    shards_dir: shardsDir,
    total,
    selected: limit,
    start,
    chunk_size: chunkSize,
    batch_size: batchSize,
    excerpt_chars: excerptChars,
    max_tokens: maxTokens,
    concurrency,
    jobs: jobs.map(job => ({ name: job.name, start: job.start, limit: job.limit, graph: job.shardGraph, log: job.log }))
  }, null, 2)}\n`, 'utf8')

  let next = 0
  const done = []
  async function worker(slot) {
    while (next < jobs.length) {
      const job = jobs[next++]
      await fs.writeFile(job.shardGraph, '{"nodes":[],"links":[]}\n', 'utf8')
      process.stderr.write(`[swarm:${slot}] start ${job.name}\n`)
      const result = await runWorker({ ...job, graph: job.shardGraph })
      done.push(result)
      process.stderr.write(`[swarm:${slot}] done ${job.name} code=${result.code}\n`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, (_, i) => worker(i + 1)))

  const failed = done.filter(j => j.code !== 0)
  console.log(JSON.stringify({
    ok: failed.length === 0,
    vault,
    graph,
    shards_dir: shardsDir,
    manifest: manifestPath,
    total,
    selected: limit,
    start,
    chunk_size: chunkSize,
    batch_size: batchSize,
    excerpt_chars: excerptChars,
    max_tokens: maxTokens,
    concurrency,
    completed: done.length,
    failed: failed.map(j => ({ name: j.name, start: j.start, limit: j.limit, log: j.log }))
  }, null, 2))
  if (failed.length) process.exit(1)
}

main().catch(error => {
  console.error(error.message || error)
  process.exit(1)
})
