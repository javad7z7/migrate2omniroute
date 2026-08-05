// Quick test: run migrator directly
const { runMigration } = require('../src/migrator');
const path = require('path');
const os = require('os');

const sourceDb = process.argv[2];
const targetDir = process.argv[3] || path.join(os.tmpdir(), 'omniroute-test-out');

if (!sourceDb) {
  console.error('Usage: node scripts/test-inject.js <path-to-9router.sqlite> [target-dir]');
  process.exit(1);
}

runMigration({
  sourceDb,
  targetDir,
  modes: ['inject'],
  includeUsage: false,
}, console.log)
  .then(r => { console.log('RESULT:', JSON.stringify(r, null, 2)); })
  .catch(e => { console.error('ERROR:', e.message); console.error(e.stack); process.exit(1); });
