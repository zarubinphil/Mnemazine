# Mnemazine Protocol

Mnemazine is a memory system, not a file dump.

## Rules

1. Raw material starts in `inbox/`.
2. Extracted text can live in `.mnemazine/cache/`.
3. The vault stores final knowledge only.
4. One source may become many notes.
5. Every note needs source links and verification state.
6. Public tools should include GitHub or official documentation links when available.
7. Graphify updates after meaningful vault changes.
8. Weekly briefs turn new knowledge into decisions.

## Completion Gate

An intake run is not complete when `inbox/` is empty.

Complete means:

1. extraction cache is written;
2. final notes are written or known cached sources are archived;
3. vault quality gate passes;
4. Graphify refresh is attempted and its status is recorded;
5. weekly HTML is regenerated;
6. report quality gate passes for the regenerated weekly HTML;
7. `.mnemazine/state/last-action-brief.md` is written;
8. any partial stage, such as semantic Graphify pending, is reported.

Agents must not claim a Mnemazine task is done before this gate runs.

## Forgetting

If an item is marked `forget`, remove it from the active vault or move it to archive. Forgetting is part of memory hygiene.
