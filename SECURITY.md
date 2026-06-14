# Security

Mnemazine is local-first. It should not require secrets for the default workflow.

Please report security issues privately through GitHub security advisories when available.

Never publish:

- API keys;
- OAuth tokens;
- SSH keys;
- browser cookies;
- private vault content;
- private screenshots;
- internal hostnames;
- personal absolute paths.

The public release check is:

```bash
bash scripts/check-public-release.sh
```
