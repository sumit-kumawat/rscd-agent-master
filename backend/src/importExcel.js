#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const { importExcel } = require('./services/import');

const filePath = process.argv[2];
const replace = process.argv.includes('--replace');

if (!filePath) {
  console.error('Usage: node src/importExcel.js <path-to-xlsx> [--replace]');
  process.exit(1);
}

(async () => {
  await connectDB();
  const buffer = fs.readFileSync(filePath);
  console.log(`Importing ${filePath} (Windows VMs only)...`);
  const result = await importExcel(buffer, { replace });
  console.log('Done:', result);
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
