// Headless smoke test for migrator.js against the real 9router DB.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { runMigration } = require('../src/migrator');

(async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-test-'));
  console.log('output dir:', outDir);

  const result = await runMigration({
    sourceDb: '/opt/9router/data/db/data.sqlite',
    targetDir: outDir,
    modes: ['json', 'sql'],
    includeUsage: false,
  }, (msg) => console.log('  ', msg));

  console.log('\nresult:', result);

  // Validate JSON
  const j = JSON.parse(fs.readFileSync(result.json, 'utf8'));
  console.log('\nvalidation:');
  console.log('  providerConnections:', j.providerConnections.length);
  console.log('  providerNodes:      ', j.providerNodes.length);
  console.log('  apiKeys:            ', j.apiKeys.length);
  console.log('  combos:             ', j.combos.length);
  console.log('  settings keys:      ', Object.keys(j.settings).length);
  console.log('  customModels:       ', Object.keys(j.customModels).length);

  // Verify tokens preserved
  const first = j.providerConnections[0];
  console.log('\nfirst connection:');
  console.log('  provider:', first.provider);
  console.log('  authType:', first.authType);
  console.log('  accessToken:', first.accessToken ? `${first.accessToken.slice(0,10)}… (${first.accessToken.length} chars)` : 'null');

  console.log('\nSQL preview:');
  const sqlLines = fs.readFileSync(result.sql, 'utf8').split('\n');
  console.log('  total lines:', sqlLines.length);
  console.log('  INSERT count:', sqlLines.filter(l => l.startsWith('INSERT')).length);

  console.log('\nOK');
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
