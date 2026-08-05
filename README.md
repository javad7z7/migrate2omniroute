# Migrate to OmniRoute

Desktop app that migrates your **9router** data (providers, OAuth tokens, API keys, combos, custom models, settings) into **OmniRoute** format.

OmniRoute is a fork of 9router, so schemas are ~95% compatible — this app handles the remaining 5% (JSON column flattening, key_value bucketizing, api_keys schema diff).

## Outputs

| File | Platform | Notes |
|---|---|---|
| `Migrate to OmniRoute-Setup-*.exe` | Windows x64 | **NSIS installer** — recommended |
| `Migrate to OmniRoute *.exe` | Windows x64 | Portable, no install needed |
| `Migrate to OmniRoute-*-win.zip` | Windows x64 | Zipped portable |
| `Migrate to OmniRoute-*-mac.zip` | macOS x64 (Intel) | Unzip → `.app`. Run `xattr -cr "Migrate to OmniRoute.app"` once to bypass Gatekeeper (unsigned) |
| `Migrate to OmniRoute-*-arm64-mac.zip` | macOS arm64 (M1/M2/M3) | Same as above |
| `Migrate to OmniRoute-*.AppImage` | Linux x64 | `chmod +x` then run |
| `migrate-to-omniroute_*_amd64.deb` | Linux x64 | `sudo dpkg -i` |

> **Windows SmartScreen warning**: The app is not code-signed (certificates cost $200+/year), so Windows shows "Windows protected your PC". This is normal for open-source apps. Click **More info → Run anyway**. The source code is fully auditable in this repo.

> **macOS Gatekeeper**: Same story — right-click → Open, or run `xattr -cr` on the `.app`.

## How to use

1. **Source** — point to your 9router `data.sqlite` (default: `~/.9router/db/data.sqlite`). Auto-detect works on standard installs.
2. **Target** — pick your OmniRoute data dir (default: `~/.omniroute/`).
3. **Output mode**:
   - **db.json** — drops a `db.json` file into the target dir. Launch OmniRoute once and it auto-imports. **Safest.**
   - **SQL file** — writes `omniroute_inject.sql`. Apply manually with `sqlite3 ~/.omniroute/db/data.sqlite < omniroute_inject.sql`.
   - **Direct inject** — writes directly into OmniRoute's `data.sqlite`. Requires OmniRoute to have run at least once (so its schema exists).
4. Click **Run migration**.

## What gets migrated

- ✅ Provider connections (OAuth tokens, API keys, priorities, health state)
- ✅ Custom provider nodes (OpenAI/Anthropic-compatible endpoints with prefix + baseUrl)
- ✅ Dashboard API keys
- ✅ Combos (model fallback chains)
- ✅ Settings (requireApiKey, headroom, quota visibility, etc.)
- ✅ Custom models (kv bucket)
- ✅ Model aliases, mitm aliases, pricing
- ⏭️ Usage history — optional checkbox, off by default

## What does NOT migrate

- `9router.env` — copy manually
- `auth/cli-secret` — copy manually (or regenerate)
- `mitm/aliases.json` — copy manually if you use MITM mode
- Logs

## Running on a headless server (no GUI)

If 9router and OmniRoute run on a Linux server with no desktop, use the one-shot bash script — it checks Node.js, clones the repo, installs deps, auto-detects paths, and runs the migration:

```bash
curl -fsSL https://raw.githubusercontent.com/javad7z7/migrate2omniroute/main/scripts/migrate2omniroute.sh | bash
```

Then restart OmniRoute — it picks up `db.json` on launch.

**Custom paths / modes:**

```bash
curl -fsSL https://raw.githubusercontent.com/javad7z7/migrate2omniroute/main/scripts/migrate2omniroute.sh -o m2o.sh
chmod +x m2o.sh

./m2o.sh --source /opt/9router/data/db/data.sqlite --target ~/.omniroute --mode json
./m2o.sh -s /custom/path/data.sqlite -m all      # json + sql + inject
```

**Manual alternative** (if you prefer step-by-step):

```bash
git clone https://github.com/javad7z7/migrate2omniroute.git
cd migrate2omniroute
npm install

node scripts/migrate-cli.js \
  --source /opt/9router/data/db/data.sqlite \
  --target ~/.omniroute \
  --mode json
```

Then restart OmniRoute — it picks up `db.json` on launch.

**Other modes:**

```bash
# Generate SQL file (apply manually with sqlite3)
node scripts/migrate-cli.js -s /opt/9router/data/db/data.sqlite -m sql
sqlite3 ~/.omniroute/db/data.sqlite < omniroute_inject.sql

# Direct inject (requires OmniRoute to have run at least once)
node scripts/migrate-cli.js -s /opt/9router/data/db/data.sqlite -m inject

# All three at once
node scripts/migrate-cli.js -s /opt/9router/data/db/data.sqlite -m all
```

**Alternative without installing anything:** copy `data.sqlite` from the server to your PC (`scp user@server:/opt/9router/data/db/data.sqlite .`), run the desktop app locally in `db.json` mode, then `scp` the resulting `db.json` back to the server's OmniRoute data dir.

## Building from source

```bash
npm install
npm run build:linux   # AppImage + deb
npm run build:win     # portable exe + zip
npm run build:mac     # zip (x64 + arm64)
npm run build:all     # all three
```

Windows builds on Linux require `wine` for NSIS installers — we ship `portable` + `zip` instead which work without wine.

macOS builds on Linux produce unsigned `.app` zips. Users need `xattr -cr` to bypass Gatekeeper. For signed/notarized DMGs, build on a real Mac with an Apple Developer account.

## Stack

- **Electron 33** + **better-sqlite3** (Node.js)
- No Go needed — better-sqlite3 handles the SQLite work natively
- electron-builder for packaging
