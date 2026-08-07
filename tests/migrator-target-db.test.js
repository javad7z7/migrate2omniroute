const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigration } = require('../src/migrator');

function createTargetSchema(dbPath) {
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE provider_connections (id TEXT PRIMARY KEY, provider TEXT, auth_type TEXT, name TEXT, email TEXT, priority INTEGER, is_active INTEGER, access_token TEXT, refresh_token TEXT, expires_at TEXT, token_expires_at TEXT, scope TEXT, project_id TEXT, test_status TEXT, error_code TEXT, last_error TEXT, last_error_at TEXT, last_error_type TEXT, last_error_source TEXT, backoff_level INTEGER, rate_limited_until TEXT, health_check_interval TEXT, last_health_check_at TEXT, last_tested TEXT, api_key TEXT, id_token TEXT, provider_specific_data TEXT, expires_in TEXT, display_name TEXT, global_priority INTEGER, default_model TEXT, token_type TEXT, consecutive_use_count INTEGER, last_used_at TEXT, rate_limit_protection INTEGER, created_at TEXT, updated_at TEXT);
  CREATE TABLE provider_nodes (id TEXT PRIMARY KEY, type TEXT, name TEXT, prefix TEXT, api_type TEXT, base_url TEXT, chat_path TEXT, models_path TEXT, custom_headers_json TEXT, created_at TEXT, updated_at TEXT);
  CREATE TABLE api_keys (id TEXT PRIMARY KEY, name TEXT, key TEXT, machine_id TEXT, allowed_models TEXT, no_log INTEGER, created_at TEXT);
  CREATE TABLE combos (id TEXT PRIMARY KEY, name TEXT, data TEXT, sort_order INTEGER, created_at TEXT, updated_at TEXT);
  CREATE TABLE key_value (namespace TEXT, key TEXT, value TEXT, PRIMARY KEY(namespace,key));`);
  db.close();
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'm2o-target-db-'));
  try {
    const sourceJson = path.join(root, 'backup.json');
    const targetDb = path.join(root, 'storage.sqlite');
    fs.writeFileSync(sourceJson, JSON.stringify({ providerConnections: [], providerNodes: [], apiKeys: [], combos: [], settings: {} }));
    createTargetSchema(targetDb);
    const result = await runMigration({ sourceJson, targetDir: root, targetDb, modes: ['inject'] }, () => {});
    assert.strictEqual(result.injectedDb, targetDb);
    console.log('PASS: migrator supports explicit target DB paths');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error.stack); process.exit(1); });
