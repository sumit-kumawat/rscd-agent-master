#!/usr/bin/env node
/**
 * Drop all application MongoDB collections and clear local app logs.
 * Use only in controlled environments before re-importing fleet data.
 *
 * Usage:
 *   docker compose exec app node scripts/db-reset.js
 *   docker compose exec app node scripts/db-reset.js --yes
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

async function main() {
  const skipConfirm = process.argv.includes('--yes') || process.argv.includes('-y');
  if (!skipConfirm && process.stdin.isTTY) {
    console.error('Refusing to run without --yes (drops ALL collections).');
    console.error('  docker compose exec app node scripts/db-reset.js --yes');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI || 'mongodb://mongodb:27017/rscd_agent_master';
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  const names = collections.map((c) => c.name).filter((n) => !n.startsWith('system.'));
  for (const name of names) {
    await db.dropCollection(name);
    console.log(`Dropped ${name}`);
  }

  const logsDir = path.join(__dirname, '../logs');
  if (fs.existsSync(logsDir)) {
    for (const file of fs.readdirSync(logsDir)) {
      if (file === '.gitkeep') continue;
      try {
        fs.unlinkSync(path.join(logsDir, file));
        console.log(`Removed log ${file}`);
      } catch {
        // ignore locked files
      }
    }
  }

  console.log('Database reset complete — re-import endpoints or run sync for fresh data.');
  console.log('Tip: POST /api/system/db-reset with {"confirm":true} after deploying v2.0.25+');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
