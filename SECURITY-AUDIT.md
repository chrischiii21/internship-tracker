# Security Audit Guide: TruffleHog + BLA

> Drop this file into the root of any web app (next to `package.json`).
> When an AI coding agent (Claude Code, Cursor, Codex, etc.) or a developer is asked to
> **"run the security audit"**, follow this file from top to bottom.

This audit has two phases:

| Phase | Tool | Question it answers | Runs on |
|---|---|---|---|
| 1. Secret scan | [TruffleHog](https://github.com/trufflesecurity/trufflehog) | "Did we leak any API keys, passwords or private keys?" | Git history, source files, and the built output |
| 2. Hardening | [BLA (Blind LLM Agents)](https://github.com/qybaihe/bla) | "Can AI agents easily reverse-engineer the code we ship to users?" | Build output only (`dist/`, `build/`, `.asar`, `.wasm`) |

**Phase 1 is required for every project. Phase 2 is optional** (see the decision guide in Phase 2).

---

## 0. Rules for the agent (read first)

1. **Never print a full secret.** In chat, reports and logs, show only the first 4 and last 4 characters (`sk_l…9fQa`), the file, the line and the commit.
2. **Never commit the report if it contains secrets.** Reports go in `security-reports/`, which must be in `.gitignore`.
3. **Don't "fix" a leaked secret by just deleting it.** It stays in Git history and has to be **rotated** (revoked and replaced). Tell the user which keys need rotating; don't try to rotate them yourself.
4. **Don't rewrite Git history** (`git filter-repo`, BFG, force-push) without the user's explicit approval.
5. **BLA only touches build output, never source code.** Run it after the build, on a fresh build, and re-test the app afterwards.
6. **Leave BLA's risky options off** (`--llm-directives`) unless the user asks for them.
7. Stop and ask the user if a step would deploy, push or change any live account.

---

## 1. Setup (one time per machine)

### TruffleHog

Pick one:

```bash
# macOS / Linux (Homebrew)
brew install trufflehog

# Any Unix (install script)
curl -sSfL https://raw.githubusercontent.com/trufflesecurity/trufflehog/main/scripts/install.sh | sh

# Docker (nothing to install)
docker run --rm -it -v "$PWD:/pwd" trufflesecurity/trufflehog:latest filesystem /pwd
```

Windows: download the binary from https://github.com/trufflesecurity/trufflehog/releases.

Check it works:

```bash
trufflehog --version
```

### BLA

BLA needs **Node.js 22+** (24.x recommended). It runs through `npx`, so there's nothing to install globally.

```bash
node --version             # must be v22 or newer
npx bla-agents setup       # optional: registers BLA's MCP tool + skill with your coding agent
```

### Project prep

Add the report folder and BLA's local files to `.gitignore`:

```gitignore
# Security audit
security-reports/
.bla-manifest.json
```

> Keep `.blarc` / `bla.config.json` **committed**. They hold the project's BLA seed, so every build is protected the same way.

---

## 2. Phase 1: Secret scan with TruffleHog

Run all three scans. Each one catches something the others miss.

```bash
mkdir -p security-reports
```

### 2a. Full Git history

Catches keys that were committed once and "deleted" later. They're still in history.

```bash
trufflehog git file://. --results=verified,unknown --json > security-reports/trufflehog-history.json
```

### 2b. Current files, including uncommitted ones

Catches secrets in `.env` files, configs and code that aren't committed yet.

```bash
trufflehog filesystem . --results=verified,unknown --json > security-reports/trufflehog-files.json
```

> `node_modules/` makes this slow and noisy. If it's too slow, scan the folders that matter instead, for example
> `trufflehog filesystem src public config .env* --results=verified,unknown --json`

### 2c. Build output (what visitors actually download)

This is the most important scan for web apps. Front-end frameworks copy any variable with a public prefix
(`NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`, `PUBLIC_`, `NUXT_PUBLIC_`) **straight into the JavaScript that every visitor downloads**.

```bash
npm run build
trufflehog filesystem dist build .next/static out --results=verified,unknown --json > security-reports/trufflehog-build.json
```

(Only list the folders your framework actually creates. Vite uses `dist`, CRA uses `build`, Next.js uses `.next/static` / `out`.)

### 2d. Understand the results

TruffleHog marks each finding as:

| Result | Meaning | What to do |
|---|---|---|
| **verified** | TruffleHog tested the key against the real service, and **it works right now**. | 🔴 **Critical.** Rotate it today. |
| **unknown** | It looks like a secret, but TruffleHog couldn't confirm either way (network error, unsupported check). | 🟠 **High.** Check it by hand. Treat it as live until proven otherwise. |
| **unverified** | It matches a secret pattern but failed verification (likely dead, a test key or a false positive). | 🟡 Low. Clean it up when convenient. Not shown with the flags above. |

> Note: verification sends the key to the provider's API to test it. That's normal and safe, but be aware of it.

### 2e. Fix what was found

For every **verified** or **unknown** finding:

1. **Rotate the key** in the provider's dashboard (Stripe, Google Cloud, AWS, Supabase, Firebase, SendGrid, etc.): revoke the old one and create a new one.
2. **Move the new key out of the code:**
   - Server-side secrets go in environment variables on the host (Vercel / Netlify / Render / VPS settings), **without** a public prefix.
   - Locally, put them in `.env.local` and make sure it's in `.gitignore`.
3. **If the key was in front-end code:** move the call that uses it into a server route or API endpoint (Next.js API route, serverless function, Express route). The browser calls your server, and only the server holds the key.
4. **Keys that are meant to be public** (Stripe *publishable* key, Firebase web config, Google Maps browser key) can stay in the front end, **but** lock them down in the provider's dashboard (allowed domains/referrers, usage limits, security rules).
5. Re-run Phase 1 until there are **zero verified and zero unknown** findings in the current files and build output.
   (History findings can stay **only** if the key has been rotated. Then the leaked copy is dead.)

---

## 3. Phase 2: Harden shipped code with BLA (optional)

### Decision guide: should this project use BLA?

| Project type | Use BLA? |
|---|---|
| Simple business site, landing page, portfolio, restaurant/menu site | ❌ **Skip.** There's nothing secret in the front end. Do Phase 1 only. |
| Web app where all the important logic runs on the server | ❌ **Skip** (optional at most). |
| Paid web app / SaaS with valuable logic **in the browser** (pricing engines, editors, games, algorithms) | ✅ Use it |
| Electron desktop app, `.asar` packages | ✅ Use it |
| App that ships WebAssembly (`.wasm`) or local AI model files | ✅ Use it |

> BLA is **not** a replacement for Phase 1. If a secret is in your bundle, BLA does not make it safe. Rotate it and move it to the server.

### 3a. Run it

Always on a **fresh build**:

```bash
npm run build
npx bla-agents harden .
```

`harden` auto-detects build output (`dist/`, `build/`, `.asar`, `.wasm`, etc.) and runs BLA's stages in order:
**audit → protect → verify**.

On the first run, BLA writes a per-project random seed to `.blarc` / `bla.config.json`. Commit that file.

Optional, opt-in only:

```bash
npx bla-agents harden . --manifest   # also writes an unsigned .bla-manifest.json (don't ship it; it's in .gitignore)
```

### 3b. Re-test the app (required)

BLA's own rule is that protection must never change how the program behaves. Still, **check it yourself**:

1. Serve the hardened build locally (`npx serve dist`, `npm run preview`, or your framework's equivalent).
2. Click through the main flows: load, login, forms, checkout, any page with heavy JavaScript.
3. Check the browser console for new errors.
4. Run the test suite if the project has one (`npm test`, Playwright/Cypress e2e).

If anything breaks, **ship the un-hardened build** and note the problem in the report.

### 3c. Limits to tell the user about

- BLA is a **new project**, and its effectiveness numbers come from the authors' own tests. Treat it as an extra layer, not a guarantee.
- It slows down AI-assisted reverse engineering. It does **not** stop a determined human, and it does **not** protect secrets.
- Unsupported: APK re-signing, firmware, GPU binaries (CUDA/SPIR-V/AMD).

---

## 4. Write the report

Save it as `security-reports/AUDIT-YYYY-MM-DD.md` using this template:

```markdown
# Security Audit — <project name> — <date>

## Summary
- Secret scan: <PASS / FAIL> — <n> verified, <n> unknown, <n> in history (rotated: yes/no)
- BLA hardening: <APPLIED / SKIPPED (reason)> — app re-tested: <yes/no>

## Findings
| # | Severity | Type (e.g. Stripe secret key) | Where (file:line or commit) | Masked value | Status |
|---|----------|-------------------------------|-----------------------------|--------------|--------|
| 1 | Critical | AWS access key | src/lib/s3.ts:12 | AKIA…7QXZ | Rotate + move to server |

## Actions for the owner
1. Rotate: <list of keys/services>
2. Move to server env vars: <list>
3. Lock down public keys: <list>

## BLA
- Targets detected: <dist/, …>
- Stages: audit ✅ protect ✅ verify ✅
- Manual test: <what was clicked through, any issues>
```

**Pass criteria:** zero verified and zero unknown secrets in current files and build output, every history finding rotated, and (if BLA was used) the hardened build tested and working.

---

## 5. Automate it (recommended)

### 5a. GitHub Action: scan every push and pull request

Create `.github/workflows/security-audit.yml`:

```yaml
name: Security Audit

on:
  push:
    branches: [main]
  pull_request:

jobs:
  secrets:
    name: TruffleHog secret scan
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0          # full history, needed for the scan

      - name: Secret Scanning
        uses: trufflesecurity/trufflehog@main
        with:
          extra_args: --results=verified,unknown

  # Optional: only for projects that use BLA (see decision guide)
  harden:
    name: Build + BLA hardening
    needs: secrets
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npm run build
      - run: npx bla-agents harden .
      - run: npm test --if-present
      # Upload or deploy the hardened build from here
```

If the secret scan fails, the build stops before anything is hardened or deployed.

### 5b. Pre-commit check: stop secrets before they're committed

Scans only the changes being committed, so it's fast:

```bash
trufflehog git file://. --since-commit HEAD --results=verified,unknown --fail
```

`--fail` makes it exit with code **183** when it finds something, which blocks the commit.

You can hook it in with [Husky](https://typicode.github.io/husky/) (`.husky/pre-commit`) or the [pre-commit framework](https://pre-commit.com/).
See TruffleHog's `PreCommit.md` for ready-made configs.

---

## 6. Quick checklist

- [ ] TruffleHog installed, `security-reports/` in `.gitignore`
- [ ] 2a: Git history scanned
- [ ] 2b: current files scanned
- [ ] 2c: build output scanned
- [ ] Every verified/unknown key rotated and moved to server env vars
- [ ] Public keys locked down (domain restrictions, quotas, rules)
- [ ] BLA: decided use / skip (with reason)
- [ ] BLA (if used): fresh build → `npx bla-agents harden .` → app re-tested
- [ ] Report written to `security-reports/AUDIT-YYYY-MM-DD.md`
- [ ] GitHub Action + pre-commit hook added

---

*Sources: [trufflesecurity/trufflehog](https://github.com/trufflesecurity/trufflehog) · [qybaihe/bla](https://github.com/qybaihe/bla)*
