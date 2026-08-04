# Migrate to OmniRoute

Desktop app that migrates your **9router** data (providers, OAuth tokens, API keys, combos, custom models, settings) into **OmniRoute** format.

OmniRoute is a fork of 9router, so schemas are ~95% compatible — this app handles the remaining 5% (JSON column flattening, key_value bucketizing, api_keys schema diff).

## Outputs

| File | Platform | Notes |
|---|---|---|
| `Migrate to OmniRoute 1.0.0.exe` | Windows x64 | Portable, no installer, double-click to run |
| `Migrate to OmniRoute-1.0.0-win.zip` | Windows x64 | Same as above, zipped |
| `Migrate to OmniRoute-1.0.0-mac.zip` | macOS x64 (Intel) | Unzip → `.app`. Run `xattr -cr "Migrate to OmniRoute.app"` once to bypass Gatekeeper (unsigned) |
| `Migrate to OmniRoute-1.0.0-arm64-mac.zip` | macOS arm64 (M1/M2/M3) | Same as above |
| `Migrate to OmniRoute-1.0.0.AppImage` | Linux x64 | `chmod +x` then run |
| `migrate-to-omniroute_1.0.0_amd64.deb` | Linux x64 | `sudo dpkg -i` |

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
