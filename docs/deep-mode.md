# Deep Mode (atomization + verification)

Mnemazine has two operating modes:

- **Conservative (default):** local-only. No network, no LLM, no external services. This is what `node scripts/mnemazine-run.mjs` and `npm run synthesize` do by default.
- **Deep (opt-in):** uses a local Codex agent to atomize one source into many focused notes (README "one source → ~20 notes") and to verify claims against their sources.

Deep mode is **off unless you ask for it**. Nothing in the default pipeline reaches the network or an LLM.

## Enabling deep mode

```bash
# whole run, deep:
node scripts/mnemazine-run.mjs --deep
# or via env (forwarded to synthesize):
MNEMAZINE_DEEP=1 node scripts/mnemazine-run.mjs

# synthesis only, deep:
npm run synthesize -- --deep
```

If deep mode is requested but Codex is not available, the run **falls back to local template synthesis** and reports `degraded: true` in its JSON output. It never fails silently.

## The Codex bridge

All LLM calls go through one shared module: `scripts/mnemazine-codex.mjs`. It reuses the same headless pattern as the repo's `scripts/kb-*-codex.sh` scripts — a single schema-constrained `codex exec` call, JSON captured via `-o`, prompt on stdin. There is no second LLM client.

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MNEMAZINE_CODEX_BIN` | `/Applications/Codex.app/Contents/Resources/codex` | Path to the Codex binary. Override to point at another install (must be an existing executable). |
| `MNEMAZINE_CODEX_TIMEOUT_MS` | `300000` | Per-call timeout. |
| `MNEMAZINE_DEEP` | unset | `1` enables deep mode (atomize + verify). |
| `MNEMAZINE_MAX_ATOMS` | `20` | Cap on atoms produced per source cluster. |

### Atomization (G4)

`scripts/mnemazine-synthesize.mjs` (with `--deep`/`--atomize`) sends each source cluster to Codex and asks for focused atoms — each with a title, what/why, how-to bullets, a next action, and the supporting source URLs. Each atom becomes its own note. Filenames are content-fingerprinted (scoped by cluster id) so re-runs are idempotent and never clobber an existing note.

### Verification (G5)

`scripts/mnemazine-verify.mjs` assigns each note a `verification_status`:

- `unknown` — no source URL anchored the claim;
- `assumed` — a source URL is present but was not fetched/checked (the **default local** verdict, zero network);
- `verified` — only under `--deep`: the source was reachable (HEAD/GET) **and** a Codex web cross-check judged it to support the claim. Such notes get `verified: true` and `status: final`.

## Security

### Untrusted input is fenced

Extracted material (OCR, transcripts, scraped web text) is **untrusted**. Before it is placed into any Codex prompt it is wrapped by `fenceUntrusted()` — an inert-data delimiter plus an explicit instruction that the content must never be executed as commands. Any literal occurrence of the fence sentinel inside the content is neutralized. This is the primary defense against prompt injection through captured material.

### Sandbox

The Codex calls run headless with the same bypass flag the repo's existing `kb-*-codex.sh` pipeline uses (non-interactive execution needs it). The prompt-layer fencing above is the active mitigation. Tightening the Codex sandbox further is a deliberate, separate decision — not required for default (conservative) operation, which never invokes Codex at all.

### Data boundary

Deep verification (`--deep`) sends claim text and source URLs to Codex, which performs web search — so locally-derived text reaches external search services **only under `--deep`**. The conservative default never does this.

### Local secret scan

`npm run release-check` (and `npm run public-check`) scan not only what could ship publicly but also the local extraction cache (`.mnemazine/cache/extracted/`) for token-like secrets (API keys, tokens, private keys), because captured screenshots or PDFs can contain credentials that would otherwise flow into synthesized notes. A captured secret fails the gate.
