# Mnemazine Agent Commands

This file mirrors `AGENTS.md` for launchers that look for `claud.md`.

If the latest user message is `Mnemazine`, run:

```bash
npm start
```

If the latest user message is `Mnemazine update`, run:

```bash
npm run update
```

If the latest user message is `Mnemazine doctor`, `Мнемозина doctor`, `проверь Mnemazine`, or `проверь Мнемозину`, run:

```bash
npm run doctor
```

Do not use `npm run run` for live inbox work. Do not process inbox files during update or doctor checks. On failure, report the command and key error; do not archive, delete, reset, or rewrite user files.
