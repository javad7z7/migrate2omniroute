const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

/**
 * Migrate 9router data to OmniRoute format.
 *
 * Modes:
 *   - "json"  → write db.json (drop into OmniRoute DATA_DIR, OmniRoute auto-imports)
 *   - "sql"   → write SQL file with INSERT OR REPLACE statements
 *   - "inject"→ directly open target OmniRoute DB and insert rows
 *
 * @param {object} opts
 * @param {string} [opts.sourceDb]   - path to 9router data.sqlite (legacy/local mode)
 * @param {string} [opts.sourceJson] - path to 9router JSON backup (portable/remote mode)
 * @param {string} opts.targetDir     - OmniRoute data dir or output folder
 * @param {string[]} opts.modes    - subset of ["json","sql","inject"]
 * @param {boolean} opts.includeUsage - include usage history (default false)
 * @param {function(string):void} log
 */
async function runMigration(opts, log) {
  const { sourceDb, sourceJson, targetDir, modes, includeUsage = false } = opts;
  if (!sourceDb && !sourceJson) throw new Error('Source JSON backup or SQLite database required');
  if (sourceDb && sourceJson) throw new Error('Choose one source: JSON backup or SQLite database');
  if (sourceDb && !fs.existsSync(sourceDb)) throw new Error(`Source DB not found: ${sourceDb}`);
  if (sourceJson && !fs.existsSync(sourceJson)) throw new Error(`Source JSON not found: ${sourceJson}`);
  if (!targetDir) throw new Error('Target directory required');
  if (!Array.isArray(modes) || modes.length === 0) throw new Error('At least one output mode required');
  fs.mkdirSync(targetDir, { recursive: true });

  let data;
  if (sourceJson) {
    log(`Reading 9router JSON backup: ${sourceJson}...`);
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(sourceJson, 'utf8')); }
    catch (err) { throw new Error(`Invalid JSON backup: ${err.message}`); }
    data = normalizeJsonBackup(parsed, log);
  } else {
    log(`Reading 9router SQLite database: ${sourceDb}...`);
    const db = new Database(sourceDb, { readonly: true, fileMustExist: true });
    data = readAll(db, includeUsage, log);
    db.close();
  }

  logStats(data, log);

  const outputs = {};

  if (modes.includes('json')) {
    const jsonPath = path.join(targetDir, 'db.json');
    fs.writeFileSync(jsonPath, JSON.stringify(data.json, null, 2), 'utf8');
    outputs.json = jsonPath;
    log(`✓ Wrote ${jsonPath} (${fs.statSync(jsonPath).size.toLocaleString()} bytes)`);
  }

  if (modes.includes('sql')) {
    const sqlPath = path.join(targetDir, 'omniroute_inject.sql');
    const sql = buildSql(data, log);
    fs.writeFileSync(sqlPath, sql, 'utf8');
    outputs.sql = sqlPath;
    log(`✓ Wrote ${sqlPath} (${fs.statSync(sqlPath).size.toLocaleString()} bytes)`);
  }

  if (modes.includes('inject')) {
    const targetDb = path.join(targetDir, 'db', 'data.sqlite');
    if (!fs.existsSync(targetDb)) {
      throw new Error(
        `Target OmniRoute DB not found: ${targetDb}\n` +
        `Run OmniRoute once first so it creates its schema, then re-run with inject mode.`
      );
    }
    injectDirect(targetDb, data, log);
    outputs.injectedDb = targetDb;
  }

  return outputs;
}

// ─── Normalize exported 9router JSON ───────────────────────

function normalizeJsonBackup(input, log) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('JSON backup must contain an object at root');
  }
  const data = {
    providerConnections: Array.isArray(input.providerConnections) ? input.providerConnections : [],
    providerNodes: Array.isArray(input.providerNodes) ? input.providerNodes : [],
    apiKeys: Array.isArray(input.apiKeys) ? input.apiKeys : [],
    combos: Array.isArray(input.combos) ? input.combos : [],
    settings: input.settings && typeof input.settings === 'object' ? input.settings : {},
    modelAliases: input.modelAliases && typeof input.modelAliases === 'object' ? input.modelAliases : {},
    mitmAlias: input.mitmAlias && typeof input.mitmAlias === 'object' ? input.mitmAlias : {},
    pricing: input.pricing && typeof input.pricing === 'object' ? input.pricing : {},
    customModels: input.customModels && typeof input.customModels === 'object' ? input.customModels : {},
  };
  if (Array.isArray(input.customModels)) {
    for (const model of input.customModels) {
      const key = model.providerAlias || model.provider || 'custom';
      if (!data.customModels[key]) data.customModels[key] = [];
      data.customModels[key].push(model);
    }
  }
  if (Array.isArray(input.usageHistory)) data.usageHistory = input.usageHistory;
  log(`  JSON backup parsed: ${JSON.stringify({
    connections: data.providerConnections.length,
    nodes: data.providerNodes.length,
    apiKeys: data.apiKeys.length,
    combos: data.combos.length,
  })}`);
  return { json: data, raw: { apiKeys: data.apiKeys, providerConnections: data.providerConnections, providerNodes: data.providerNodes, combos: data.combos, settings: data.settings, kvBuckets: { customModels: data.customModels, modelAliases: data.modelAliases, mitmAlias: data.mitmAlias, pricing: data.pricing }, usageHistory: data.usageHistory || null } };
}

// ─── Read everything from 9router ───────────────────────────

function readAll(db, includeUsage, log) {
  const providerConnections = db.prepare(`
    SELECT id, provider, authType, name, email, priority, isActive,
           data, createdAt, updatedAt
    FROM providerConnections
  `).all().map(row => flattenConnection(row));
  log(`  connections: ${providerConnections.length}`);

  const providerNodes = db.prepare(`
    SELECT id, type, name, data, createdAt, updatedAt
    FROM providerNodes
  `).all().map(row => flattenNode(row));
  log(`  nodes: ${providerNodes.length}`);

  const apiKeys = db.prepare(`
    SELECT id, key, name, machineId, isActive, createdAt
    FROM apiKeys
  `).all();
  log(`  api keys: ${apiKeys.length}`);

  const combos = db.prepare(`
    SELECT id, name, kind, models, createdAt, updatedAt
    FROM combos
  `).all().map((row, idx) => flattenCombo(row, idx));
  log(`  combos: ${combos.length}`);

  const settingsRow = db.prepare(`SELECT data FROM settings WHERE id = 1`).get();
  const settings = settingsRow ? safeJson(settingsRow.data) || {} : {};

  // kv scope buckets
  const kvBuckets = {
    customModels: {},
    modelAliases: {},
    mitmAlias: {},
    pricing: {},
  };
  try {
    const kvRows = db.prepare(`SELECT scope, key, value FROM kv`).all();
    for (const r of kvRows) {
      const v = safeJson(r.value);
      if (v === null) continue;
      if (kvBuckets[r.scope]) kvBuckets[r.scope][r.key] = v;
      else if (r.scope === 'settings') settings[r.key] = v;
    }
    log(`  kv rows: ${kvRows.length}`);
  } catch {}

  // Optional usage history
  let usageHistory = null;
  if (includeUsage) {
    try {
      usageHistory = db.prepare(`
        SELECT id, timestamp, provider, model, connectionId, apiKey,
               endpoint, promptTokens, completionTokens, cost, status, tokens, meta
        FROM usageHistory
      `).all();
      log(`  usage history rows: ${usageHistory.length}`);
    } catch {}
  }

  // Shape matching OmniRoute's migrateFromJson() expected input
  const jsonShape = {
    providerConnections,
    providerNodes,
    apiKeys: apiKeys.map(k => ({
      id: k.id, key: k.key, name: k.name,
      machineId: k.machineId,
      isActive: !!k.isActive,
      createdAt: k.createdAt,
    })),
    combos,
    settings,
    modelAliases: kvBuckets.modelAliases,
    mitmAlias: kvBuckets.mitmAlias,
    pricing: kvBuckets.pricing,
    customModels: kvBuckets.customModels,
  };
  if (usageHistory) jsonShape.usageHistory = usageHistory;

  return { json: jsonShape, raw: { apiKeys, providerConnections, providerNodes, combos, settings, kvBuckets, usageHistory } };
}

function flattenConnection(row) {
  const blob = safeJson(row.data) || {};
  return {
    id: row.id,
    provider: row.provider,
    authType: row.authType || 'oauth',
    name: row.name,
    email: row.email,
    priority: row.priority ?? 0,
    isActive: !!row.isActive,
    accessToken: blob.accessToken ?? null,
    refreshToken: blob.refreshToken ?? null,
    idToken: blob.idToken ?? null,
    apiKey: blob.apiKey ?? null,
    expiresAt: blob.expiresAt ?? null,
    tokenExpiresAt: blob.tokenExpiresAt ?? null,
    expiresIn: blob.expiresIn ?? null,
    scope: blob.scope ?? null,
    projectId: blob.projectId ?? null,
    testStatus: blob.testStatus ?? null,
    errorCode: blob.errorCode ?? null,
    lastError: blob.lastError ?? null,
    lastErrorAt: blob.lastErrorAt ?? null,
    lastErrorType: blob.lastErrorType ?? null,
    lastErrorSource: blob.lastErrorSource ?? null,
    backoffLevel: blob.backoffLevel ?? 0,
    rateLimitedUntil: blob.rateLimitedUntil ?? null,
    healthCheckInterval: blob.healthCheckInterval ?? null,
    lastHealthCheckAt: blob.lastHealthCheckAt ?? null,
    lastTested: blob.lastTested ?? null,
    lastUsedAt: blob.lastUsedAt ?? null,
    consecutiveUseCount: blob.consecutiveUseCount ?? 0,
    rateLimitProtection: !!blob.rateLimitProtection,
    tokenType: blob.tokenType ?? null,
    providerSpecificData: blob.providerSpecificData ?? {},
    displayName: blob.displayName ?? null,
    globalPriority: blob.globalPriority ?? null,
    defaultModel: blob.defaultModel ?? null,
    createdAt: row.createdAt || new Date().toISOString(),
    updatedAt: row.updatedAt || new Date().toISOString(),
  };
}

function flattenNode(row) {
  const blob = safeJson(row.data) || {};
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    prefix: blob.prefix ?? null,
    apiType: blob.apiType ?? null,
    baseUrl: blob.baseUrl ?? null,
    chatPath: blob.chatPath ?? null,
    modelsPath: blob.modelsPath ?? null,
    customHeaders: blob.customHeaders ?? null,
    createdAt: row.createdAt || new Date().toISOString(),
    updatedAt: row.updatedAt || new Date().toISOString(),
  };
}

function flattenCombo(row, idx) {
  const models = safeJson(row.models) || [];
  return {
    id: row.id,
    name: row.name,
    kind: row.kind ?? null,
    models,
    sortOrder: idx + 1,
    createdAt: row.createdAt || new Date().toISOString(),
    updatedAt: row.updatedAt || new Date().toISOString(),
  };
}

function safeJson(s) {
  if (typeof s !== 'string' || !s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function logStats(data, log) {
  const j = data.json;
  log('');
  log('── Summary ──────────────────────');
  log(`  providerConnections: ${j.providerConnections.length}`);
  log(`  providerNodes:       ${j.providerNodes.length}`);
  log(`  apiKeys:             ${j.apiKeys.length}`);
  log(`  combos:              ${j.combos.length}`);
  log(`  settings keys:       ${Object.keys(j.settings).length}`);
  log(`  customModels:        ${Object.keys(j.customModels).length}`);
  if (j.usageHistory) log(`  usageHistory:        ${j.usageHistory.length}`);
  log('');
}

// ─── SQL builder ────────────────────────────────────────────

function sqlEscape(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function buildSql(data, log) {
  const lines = [
    '-- 9router → OmniRoute migration',
    '-- Generated by Migrate to OmniRoute (Electron app)',
    '-- Idempotent: safe to re-run (INSERT OR REPLACE).',
    '',
  ];

  const j = data.json;

  // provider_connections
  lines.push('-- provider_connections');
  const pcCols = [
    'id','provider','auth_type','name','email','priority','is_active',
    'access_token','refresh_token','expires_at','token_expires_at','scope',
    'project_id','test_status','error_code','last_error','last_error_at',
    'last_error_type','last_error_source','backoff_level','rate_limited_until',
    'health_check_interval','last_health_check_at','last_tested','api_key',
    'id_token','provider_specific_data','expires_in','display_name',
    'global_priority','default_model','token_type','consecutive_use_count',
    'last_used_at','rate_limit_protection','created_at','updated_at',
  ];
  for (const c of j.providerConnections) {
    const vals = [
      sqlEscape(c.id), sqlEscape(c.provider), sqlEscape(c.authType),
      sqlEscape(c.name), sqlEscape(c.email), c.priority, c.isActive ? 1 : 0,
      sqlEscape(c.accessToken), sqlEscape(c.refreshToken),
      sqlEscape(c.expiresAt), sqlEscape(c.tokenExpiresAt),
      sqlEscape(c.scope), sqlEscape(c.projectId), sqlEscape(c.testStatus),
      sqlEscape(c.errorCode), sqlEscape(c.lastError), sqlEscape(c.lastErrorAt),
      sqlEscape(c.lastErrorType), sqlEscape(c.lastErrorSource),
      c.backoffLevel, sqlEscape(c.rateLimitedUntil),
      sqlEscape(c.healthCheckInterval), sqlEscape(c.lastHealthCheckAt),
      sqlEscape(c.lastTested), sqlEscape(c.apiKey), sqlEscape(c.idToken),
      sqlEscape(JSON.stringify(c.providerSpecificData || {})),
      sqlEscape(c.expiresIn), sqlEscape(c.displayName),
      sqlEscape(c.globalPriority), sqlEscape(c.defaultModel),
      sqlEscape(c.tokenType), c.consecutiveUseCount,
      sqlEscape(c.lastUsedAt), c.rateLimitProtection ? 1 : 0,
      sqlEscape(c.createdAt), sqlEscape(c.updatedAt),
    ];
    lines.push(`INSERT OR REPLACE INTO provider_connections (${pcCols.join(',')}) VALUES (${vals.join(',')});`);
  }
  lines.push('');

  // provider_nodes
  lines.push('-- provider_nodes');
  const pnCols = ['id','type','name','prefix','api_type','base_url','chat_path','models_path','custom_headers_json','created_at','updated_at'];
  for (const n of j.providerNodes) {
    const vals = [
      sqlEscape(n.id), sqlEscape(n.type), sqlEscape(n.name),
      sqlEscape(n.prefix), sqlEscape(n.apiType), sqlEscape(n.baseUrl),
      sqlEscape(n.chatPath), sqlEscape(n.modelsPath),
      sqlEscape(n.customHeaders ? JSON.stringify(n.customHeaders) : null),
      sqlEscape(n.createdAt), sqlEscape(n.updatedAt),
    ];
    lines.push(`INSERT OR REPLACE INTO provider_nodes (${pnCols.join(',')}) VALUES (${vals.join(',')});`);
  }
  lines.push('');

  // api_keys — OmniRoute schema has no is_active
  lines.push('-- api_keys');
  const akCols = ['id','name','key','machine_id','allowed_models','no_log','created_at'];
  for (const k of data.raw.apiKeys) {
    const vals = [
      sqlEscape(k.id), sqlEscape(k.name), sqlEscape(k.key),
      sqlEscape(k.machineId), sqlEscape('[]'),
      k.isActive ? 0 : 1,
      sqlEscape(k.createdAt || new Date().toISOString()),
    ];
    lines.push(`INSERT OR REPLACE INTO api_keys (${akCols.join(',')}) VALUES (${vals.join(',')});`);
  }
  lines.push('');

  // combos
  lines.push('-- combos');
  const cbCols = ['id','name','data','sort_order','created_at','updated_at'];
  for (const c of j.combos) {
    const vals = [
      sqlEscape(c.id), sqlEscape(c.name),
      sqlEscape(JSON.stringify(c)),
      c.sortOrder, sqlEscape(c.createdAt), sqlEscape(c.updatedAt),
    ];
    lines.push(`INSERT OR REPLACE INTO combos (${cbCols.join(',')}) VALUES (${vals.join(',')});`);
  }
  lines.push('');

  // key_value
  lines.push('-- key_value (settings + customModels + modelAliases + mitmAlias + pricing)');
  const buckets = [
    ['settings', j.settings],
    ['modelAliases', j.modelAliases],
    ['mitmAlias', j.mitmAlias],
    ['pricing', j.pricing],
    ['customModels', j.customModels],
  ];
  for (const [ns, bag] of buckets) {
    if (!bag) continue;
    for (const [k, v] of Object.entries(bag)) {
      lines.push(
        `INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (${sqlEscape(ns)}, ${sqlEscape(k)}, ${sqlEscape(JSON.stringify(v))});`
      );
    }
  }
  lines.push('');

  return lines.join('\n');
}

// ─── Direct DB injection ────────────────────────────────────

function injectDirect(targetDb, data, log) {
  log(`Opening target: ${targetDb}`);
  const db = new Database(targetDb);

  // Sanity: verify OmniRoute schema present
  const required = ['provider_connections', 'provider_nodes', 'api_keys', 'combos', 'key_value'];
  for (const t of required) {
    const row = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(t);
    if (!row) {
      db.close();
      throw new Error(`Target DB missing table: ${t}. Run OmniRoute once first.`);
    }
  }

  const tx = db.transaction(() => {
    // connections
    const insConn = db.prepare(`
      INSERT OR REPLACE INTO provider_connections (
        id,provider,auth_type,name,email,priority,is_active,
        access_token,refresh_token,expires_at,token_expires_at,scope,
        project_id,test_status,error_code,last_error,last_error_at,
        last_error_type,last_error_source,backoff_level,rate_limited_until,
        health_check_interval,last_health_check_at,last_tested,api_key,
        id_token,provider_specific_data,expires_in,display_name,
        global_priority,default_model,token_type,consecutive_use_count,
        last_used_at,rate_limit_protection,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    let n = 0;
    for (const c of data.json.providerConnections) {
      insConn.run(
        c.id, c.provider, c.authType, c.name, c.email, c.priority, c.isActive ? 1 : 0,
        c.accessToken, c.refreshToken, c.expiresAt, c.tokenExpiresAt, c.scope,
        c.projectId, c.testStatus, c.errorCode, c.lastError, c.lastErrorAt,
        c.lastErrorType, c.lastErrorSource, c.backoffLevel, c.rateLimitedUntil,
        c.healthCheckInterval, c.lastHealthCheckAt, c.lastTested, c.apiKey,
        c.idToken, JSON.stringify(c.providerSpecificData || {}), c.expiresIn,
        c.displayName, c.globalPriority, c.defaultModel, c.tokenType,
        c.consecutiveUseCount, c.lastUsedAt, c.rateLimitProtection ? 1 : 0,
        c.createdAt, c.updatedAt
      );
      n++;
    }
    log(`  injected ${n} connections`);

    // nodes
    const insNode = db.prepare(`
      INSERT OR REPLACE INTO provider_nodes (
        id,type,name,prefix,api_type,base_url,chat_path,models_path,custom_headers_json,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `);
    n = 0;
    for (const nd of data.json.providerNodes) {
      insNode.run(
        nd.id, nd.type, nd.name, nd.prefix, nd.apiType, nd.baseUrl,
        nd.chatPath, nd.modelsPath,
        nd.customHeaders ? JSON.stringify(nd.customHeaders) : null,
        nd.createdAt, nd.updatedAt
      );
      n++;
    }
    log(`  injected ${n} nodes`);

    // api keys
    const insKey = db.prepare(`
      INSERT OR REPLACE INTO api_keys (id,name,key,machine_id,allowed_models,no_log,created_at)
      VALUES (?,?,?,?,?,?,?)
    `);
    n = 0;
    for (const k of data.raw.apiKeys) {
      insKey.run(k.id, k.name, k.key, k.machineId, '[]', k.isActive ? 0 : 1, k.createdAt || new Date().toISOString());
      n++;
    }
    log(`  injected ${n} api keys`);

    // combos
    const insCombo = db.prepare(`
      INSERT OR REPLACE INTO combos (id,name,data,sort_order,created_at,updated_at)
      VALUES (?,?,?,?,?,?)
    `);
    n = 0;
    for (const c of data.json.combos) {
      insCombo.run(c.id, c.name, JSON.stringify(c), c.sortOrder, c.createdAt, c.updatedAt);
      n++;
    }
    log(`  injected ${n} combos`);

    // key_value
    const insKv = db.prepare(`
      INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?,?,?)
    `);
    n = 0;
    const buckets = [
      ['settings', data.json.settings],
      ['modelAliases', data.json.modelAliases],
      ['mitmAlias', data.json.mitmAlias],
      ['pricing', data.json.pricing],
      ['customModels', data.json.customModels],
    ];
    for (const [ns, bag] of buckets) {
      if (!bag) continue;
      for (const [k, v] of Object.entries(bag)) {
        insKv.run(ns, k, JSON.stringify(v));
        n++;
      }
    }
    log(`  injected ${n} key_value rows`);
  });

  tx();
  db.close();
  log(`✓ Direct injection complete.`);
}

module.exports = { runMigration };
