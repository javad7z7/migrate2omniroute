# Migrate to OmniRoute

JSON-first migration toolkit for moving **9router** providers, OAuth tokens, API keys, combos, custom models, aliases, and settings into **OmniRoute** format.

Works with 9router dashboard JSON backups from Docker, VPS, NAS, and remote installs. Local SQLite migration remains available for desktop and server operators who need direct access.

**Website:** [javad7z7.github.io/migrate2omniroute](https://javad7z7.github.io/migrate2omniroute/)

**Web Migrator:** [Open in browser](https://javad7z7.github.io/migrate2omniroute/migrate.html) — local-only JSON conversion; no backup upload.

**Desktop app:** Windows, macOS, and Linux builds with JSON, SQLite, SQL, and direct-inject modes.

The project normalizes the differences between 9router and OmniRoute schemas, including JSON columns, key-value namespaces, API keys, combos, and custom models.

## Choose your path

| Situation                                          | Use                                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 9router runs in Docker, VPS, NAS, or remote server | [Web Migrator](https://javad7z7.github.io/migrate2omniroute/migrate.html) with dashboard JSON backup  |
| You want a guided local app                        | Desktop release from [GitHub Releases](https://github.com/javad7z7/migrate2omniroute/releases/latest) |
| Linux VPS / headless server                        | Interactive `scripts/migrate2omniroute.sh`                                                            |
| CI or custom automation                            | `scripts/migrate-cli.js`                                                                              |
| Direct local database injection                    | Desktop/CLI `inject` mode with an explicit target database                                            |

The web tool processes JSON in your browser. It cannot access server files or perform direct database injection; use Desktop or CLI for those modes.

## Outputs

| File                                   | Platform               | Notes                                                                                            |
| -------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| `Migrate to OmniRoute-Setup-*.exe`     | Windows x64            | **NSIS installer** — recommended                                                                 |
| `Migrate to OmniRoute *.exe`           | Windows x64            | Portable, no install needed                                                                      |
| `Migrate to OmniRoute-*-win.zip`       | Windows x64            | Zipped portable                                                                                  |
| `Migrate to OmniRoute-*-mac.dmg`       | macOS x64 (Intel)      | Open DMG → drag app to **Applications**. Unsigned builds may need right-click → Open             |
| `Migrate to OmniRoute-*-arm64-mac.dmg` | macOS arm64 (M1/M2/M3) | Same drag-to-Applications flow                                                                   |
| `Migrate to OmniRoute-*-mac.zip`       | macOS x64 (Intel)      | Fallback archive. Unzip → `.app`; `xattr -cr "Migrate to OmniRoute.app"` if Gatekeeper blocks it |
| `Migrate to OmniRoute-*-arm64-mac.zip` | macOS arm64 (M1/M2/M3) | Same fallback archive                                                                            |
| `Migrate to OmniRoute-*.AppImage`      | Linux x64              | `chmod +x` then run                                                                              |
| `migrate-to-omniroute_*_amd64.deb`     | Linux x64              | `sudo dpkg -i`                                                                                   |

> **Windows SmartScreen warning**: The app is not code-signed (certificates cost $200+/year), so Windows shows "Windows protected your PC". This is normal for open-source apps. Click **More info → Run anyway**. The source code is fully auditable in this repo.

> **macOS Gatekeeper**: Same story — right-click → Open, or run `xattr -cr` on the `.app`.

## How to use

1. **Source** — upload 9router dashboard JSON backup (recommended; works with Docker, VPS and remote installs), or choose local `data.sqlite` for legacy/local migration.
2. **Target** — pick an output folder, or select OmniRoute’s local data directory/database.
3. **Output mode**:
   - **db.json** — drops a `db.json` file into the target dir. Launch OmniRoute once and it auto-imports. **Safest.**
   - **SQL file** — writes `omniroute_inject.sql`. Apply it only after verifying the target schema/version.
   - **Direct inject** — writes directly into OmniRoute’s `storage.sqlite`. Requires OmniRoute to have run at least once (so its schema exists).
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

## Interactive server migration (recommended for Linux/VPS)

The Bash installer is the simplest route for a server. It starts with a menu:

1. **OmniRoute already exists** — backs up 9router, backs up OmniRoute, then migrates into the selected OmniRoute database.
2. **OmniRoute is not installed** — checks for Docker + Docker Compose, offers to install missing dependencies, launches a separate OmniRoute container, then migrates into it.
3. **Exit** — makes no changes.

It always creates timestamped, private backups and a log at:

```text
~/.migrate2omniroute/runs/<UTC-timestamp>/
```

That folder contains the 9router backup, pre-migration OmniRoute backup, migration output, and `migration.log`. Tokens and API keys never leave the server.

```bash
curl -fsSLO https://raw.githubusercontent.com/javad7z7/migrate2omniroute/main/scripts/migrate2omniroute.sh
bash migrate2omniroute.sh
```

### What it installs and why

The script asks before installing anything. It installs only what the chosen path needs:

- **Node.js 18+ and npm** — runs the existing migration engine.
- **sqlite3** — creates integrity-checked SQLite backups.
- **Docker Engine + Docker Compose plugin** — only for the “install OmniRoute” branch.

It never asks for or handles your sudo password. If the OS requires admin permissions, it displays/runs the normal package-manager command only after you approve it. On an unsupported distro or host without usable Docker access, it stops with an actionable message.

### New isolated OmniRoute install

For a new installation, the script uses the official `diegosouzapw/omniroute:latest` image and creates (by default `/var/lib/omniroute` when root, or `~/omniroute` when non-root):

```text
/var/lib/omniroute/
├── compose.yml
└── data/                  # mounted at /app/data in the container
```

OmniRoute normally uses dashboard port `20128`. The script checks listening host and Docker ports, proposes `20128`, and picks the next available port (`20129`–`20150`) if needed. You can accept it or choose another port. It never intentionally reuses an occupied 9router port.

Before `docker compose up -d`, it prints the image, data directory, port, and URL and asks for confirmation. The dashboard is then available at `http://SERVER_IP:PORT`.

### Existing OmniRoute install

If you already run OmniRoute, select option 1 or give its database explicitly. The script does **not** install a second container or change the existing service’s port/config. It verifies the expected schema and backs up the target before injection.

```bash
# Existing 9router SQLite + existing OmniRoute target
bash migrate2omniroute.sh \
  --source /opt/9router/data/db/data.sqlite \
  --target-db /path/to/omniroute/storage.sqlite

# 9router dashboard backup + new isolated OmniRoute on a chosen port
bash migrate2omniroute.sh \
  --json ./9router-backup.json \
  --install-omniroute \
  --port 20130
```

### Dockerized 9router

For a Docker source, pass `CONTAINER:/absolute/path/in/container`. To get a consistent raw SQLite copy, the script explains and asks permission to stop the 9router container briefly, copies the database, runs `PRAGMA integrity_check`, then restores its original running state. If downtime is not acceptable, export a dashboard JSON backup and pass it with `--json`.

```bash
bash migrate2omniroute.sh \
  --source 9router:/app/data/data.sqlite \
  --target-db /path/to/omniroute/storage.sqlite
```

### Automation flags

```text
--source PATH             9router SQLite file or container:/path
--json PATH               9router dashboard JSON backup
--target-db PATH          existing OmniRoute storage.sqlite
--install-omniroute       provision a separate Dockerized OmniRoute
--port PORT               requested dashboard port for a new install
--yes                     accept ordinary confirmations
--non-interactive         fail rather than ask for required choices
```

`--yes` does not ignore a port conflict. Review `--help` before unattended use.

## Manual CLI alternative

```bash
git clone https://github.com/javad7z7/migrate2omniroute.git
cd migrate2omniroute
npm install

node scripts/migrate-cli.js \
  --source /opt/9router/data/db/data.sqlite \
  --target ./omniroute-output \
  --mode json
```

Then restart OmniRoute — it picks up `db.json` on launch.

**Other modes:**

```bash
# Generate SQL file (apply only after verifying target schema/version)
node scripts/migrate-cli.js -s /opt/9router/data/db/data.sqlite -m sql

# Direct inject into OmniRoute (requires OmniRoute to have run at least once)
node scripts/migrate-cli.js \
  -s /opt/9router/data/db/data.sqlite \
  --target-db /path/to/omniroute/storage.sqlite \
  -m inject

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
