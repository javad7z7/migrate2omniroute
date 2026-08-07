#!/usr/bin/env node
/**
 * migrate-cli.js — Headless 9router → OmniRoute migration for servers.
 *
 * Usage:
 *   node migrate-cli.js --json ./9router-backup.json \
 *                       --target ./omniroute-output \
 *                       --mode json
 *
 *   node migrate-cli.js --source /opt/9router/data/db/data.sqlite \
 *                       --target ~/.omniroute \
 *                       --mode inject
 *
 * Modes: json (default, safest) | sql | inject | all
 *
 * Zero dependencies except better-sqlite3 (auto-installs if missing).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Args ──────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { mode: 'json', includeUsage: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json' || a === '-j') args.json = argv[++i];
    else if (a === '--source' || a === '-s') args.source = argv[++i];
    else if (a === '--target' || a === '-t') args.target = argv[++i];
    else if (a === '--target-db') args.targetDb = argv[++i];
    else if (a === '--mode' || a === '-m') args.mode = argv[++i];
    else if (a === '--include-usage') args.includeUsage = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

const args = parseArgs(process.argv);

if (args.help || (!args.source && !args.json)) {
  console.log(`
9router → OmniRoute migration CLI

Usage:
  node migrate-cli.js --source <path-to-data.sqlite> [options]

Options:
  -j, --json <path>      9router dashboard JSON backup (recommended)
  -s, --source <path>    9router data.sqlite (local/legacy mode)
  -t, --target <dir>     OmniRoute data dir or output folder
                         (default: ./omniroute-output)
      --target-db <path> Explicit OmniRoute storage.sqlite for inject mode
  -m, --mode <mode>      json | sql | inject | all  (default: json)
      --include-usage    Also migrate usage history (~20k rows)
  -h, --help             Show this help

Examples:
  # Safest: produce db.json, OmniRoute auto-imports on next start
  node migrate-cli.js -s /opt/9router/data/db/data.sqlite -t ~/.omniroute -m json

  # Direct inject into OmniRoute's existing DB
  node migrate-cli.js -s /opt/9router/data/db/data.sqlite -t ~/.omniroute -m inject

  # Generate all outputs
  node migrate-cli.js -s /opt/9router/data/db/data.sqlite -m all
`);
  process.exit(args.help ? 0 : 1);
}

// ── Dependency check ─────────────────────────────────────────
let Database;
try {
  Database = require('better-sqlite3');
} catch {
  console.error('better-sqlite3 not found. Installing...');
  const { execSync } = require('child_process');
  const dir = __dirname;
  try {
    execSync('npm install --no-save better-sqlite3', { cwd: dir, stdio: 'inherit' });
    Database = require('better-sqlite3');
  } catch (e) {
    console.error('Failed to install better-sqlite3. Run manually:');
    console.error('  npm install better-sqlite3');
    process.exit(1);
  }
}

// ── Resolve paths ─────────────────────────────────────────────
const sourceDb = args.source ? path.resolve(args.source.replace(/^~/, os.homedir())) : null;
const sourceJson = args.json ? path.resolve(args.json.replace(/^~/, os.homedir())) : null;
const targetDir = path.resolve(
  (args.target || './omniroute-output').replace(/^~/, os.homedir())
);

const sourcePath = sourceJson || sourceDb;
if (!fs.existsSync(sourcePath)) {
  console.error(`✗ Source not found: ${sourcePath}`);
  process.exit(1);
}

// ── Run migration ─────────────────────────────────────────────
const { runMigration } = require(path.join(__dirname, '..', 'src', 'migrator'));

const modes = args.mode === 'all' ? ['json', 'sql', 'inject'] : [args.mode];
const validModes = ['json', 'sql', 'inject'];
for (const m of modes) {
  if (!validModes.includes(m)) {
    console.error(`✗ Invalid mode: ${m}. Use: ${validModes.join(', ')}`);
    process.exit(1);
  }
}

console.log('9router → OmniRoute migration');
console.log(`  source:  ${sourcePath}`);
console.log(`  format:  ${sourceJson ? 'JSON backup' : 'SQLite database'}`);
console.log(`  target:  ${targetDir}`);
console.log(`  modes:   ${modes.join(', ')}`);
console.log('');

runMigration(
  { sourceDb, sourceJson, targetDir, targetDb: args.targetDb ? path.resolve(args.targetDb.replace(/^~/, os.homedir())) : undefined, modes, includeUsage: args.includeUsage },
  (msg) => console.log(msg)
)
  .then(() => {
    console.log('');
    console.log('✓ Done.');
    if (modes.includes('json')) {
      console.log(`  → Copy ${path.join(targetDir, 'db.json')} to OmniRoute DATA_DIR`);
      console.log('    OmniRoute auto-imports on next launch.');
    }
    if (modes.includes('sql')) {
      console.log(`  → Apply with: sqlite3 ~/.omniroute/data.sqlite < ${path.join(targetDir, 'omniroute_inject.sql')}`);
    }
  })
  .catch((err) => {
    console.error(`✗ Migration failed: ${err.message}`);
    process.exit(1);
  });
