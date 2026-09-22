#!/usr/bin/env node
/**
 * Drop application collections (no seed data). Use only in controlled environments.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://mongodb:27017/rscd_agent_master';
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  const names = collections.map((c) => c.name).filter((n) => !n.startsWith('system.'));
  for (const name of names) {
    await db.dropCollection(name);
    console.log(`Dropped ${name}`);
  }
  console.log('Database reset complete — no seed data inserted.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
