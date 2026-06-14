# Contributing

Mnemazine accepts contributions that make the system more portable, safer, and easier to use.

Good contributions:

- improve extraction quality;
- add source parsers;
- improve vault quality gates;
- add agent skills;
- improve Graphify integration;
- improve local-first installation;
- remove assumptions about one user or one machine.

Before opening a pull request:

```bash
bash scripts/check-public-release.sh
node scripts/mnemazine-vault-quality-gate.mjs --vault demo/vault
```

Do not commit secrets, private vaults, raw personal screenshots, cookies, tokens, or machine-specific paths.
