const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Package = require('../models/Package');
const deployConfig = require('../config/deployConfig');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function detectType(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.msi')) return 'msi';
  if (lower.endsWith('.exe')) return 'exe';
  return 'unknown';
}

async function saveUpload({ buffer, originalName, name, expectedSha256, uploadedBy }) {
  const maxBytes = deployConfig.maxPackageMb * 1024 * 1024;
  if (buffer.length > maxBytes) {
    throw new Error(`Package exceeds maximum size of ${deployConfig.maxPackageMb} MB`);
  }
  const sha256 = sha256Buffer(buffer);
  if (expectedSha256 && expectedSha256.toLowerCase() !== sha256) {
    throw new Error('Package SHA-256 does not match expected value');
  }
  ensureDir(deployConfig.packageDir);
  const safeName = path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = path.join(deployConfig.packageDir, `${Date.now()}-${safeName}`);
  fs.writeFileSync(storagePath, buffer);

  const doc = await Package.create({
    name: name || safeName,
    fileName: safeName,
    size: buffer.length,
    sha256,
    expectedSha256: expectedSha256 || sha256,
    storagePath,
    packageType: detectType(safeName),
    uploadedBy: uploadedBy || 'system',
  });
  return doc;
}

async function listPackages() {
  return Package.find().sort({ createdAt: -1 }).lean();
}

async function getPackage(id) {
  return Package.findById(id);
}

async function removePackage(id) {
  const pkg = await Package.findById(id);
  if (!pkg) return null;
  try {
    if (pkg.storagePath && fs.existsSync(pkg.storagePath)) fs.unlinkSync(pkg.storagePath);
  } catch {
    // file already removed
  }
  await Package.deleteOne({ _id: id });
  return pkg;
}

function readPackageBytes(pkg) {
  return fs.readFileSync(pkg.storagePath);
}

module.exports = {
  saveUpload,
  listPackages,
  getPackage,
  removePackage,
  readPackageBytes,
  sha256Buffer,
};
