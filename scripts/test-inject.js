// Test direct injection mode.
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');
const { runMigration } = require('../src/migrator');

(async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-inject-'));
  const dbDir = path.join(outDir, 'db');
  fs.mkdirSync(dbDir, { recursive: true });

  // Build empty OmniRoute schema in target DB
  const targetDb = path.join(dbDir, 'data.sqlite');
  const db = new Database(targetDb);
  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_connections (
      id TEXT PRIMARY KEY, provider TEXT, auth_type TEXT, name TEXT, email TEXT,
      priority INTEGER, is_active INTEGER, access_token TEXT, refresh_token TEXT,
      expires_at TEXT, token_expires_at TEXT, scope TEXT, project_id TEXT,
      test_status TEXT, error_code TEXT, last_error TEXT, last_error_at TEXT,
      last_error_type TEXT, last_error_source TEXT, backoff_level INTEGER,
      rate_limited_until TEXT, health_check_interval INTEGER, last_health_check_at TEXT,
      last_tested TEXT, api_key TEXT, id_token TEXT, provider_specific_data TEXT,
      expires_in INTEGER, display_name TEXT, global_priority INTEGER, default_model TEXT,
      token_type TEXT, consecutive_use_count INTEGER, rate_limit_protection INTEGER,
      last_used_at TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS provider_nodes (
      id TEXT PRIMARY KEY, type TEXT, name TEXT, prefix TEXT, api_type TEXT,
      base_url TEXT, chat_path TEXT, models_path TEXT, custom_headers_json TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, key TEXT NOT NULL UNIQUE,
      machine_id TEXT, allowed_models TEXT DEFAULT '[]', no_log INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS combos (
      id TEXT PRIMARY KEY, name TEXT, data TEXT, sort_order INTEGER,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS key_value (
      namespace TEXT, key TEXT, value TEXT, PRIMARY KEY(namespace, key)
    );
  `);
  db.close();
  console.log('target DB prepared:', targetDb);

  const result = await runMigration({
    sourceDb: '/opt/9router/data/db/data.sqlite',
    targetDir: outDir,
    modes: ['inject'],
    includeUsage: false,
  }, (msg) => console.log('  ', msg));

  console.log('\nresult:', result);

  // Verify
  const v = new Database(targetDb, { readonly: true });
  for (const t of ['provider_connections','provider_nodes','api_keys','combos','key_value']) {
    const c = v.prepare(`SELECT COUNT(*) as c FROM ${t}`).get().c;
    console.log(`  ${t}: ${c}`);
  }
  const conn = v.prepare("SELECT provider, auth_type, name, length(access_token) as at_len FROM provider_connections WHERE name='Account 1'").get();
  console.log('  Account 1:', conn);
  v.close();

  console.log('\nOK');
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
