const path = require('path');

function readInt(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const dataRoot = process.env.DEPLOY_PACKAGE_DIR
  || path.join(__dirname, '../../data/packages');

module.exports = {
  concurrency: readInt('DEPLOY_CONCURRENCY', 5),
  rndConcurrency: readInt('RND_DEPLOY_CONCURRENCY', readInt('DEPLOY_CONCURRENCY', 5)),
  prodConcurrency: readInt('PROD_DEPLOY_CONCURRENCY', Math.min(3, readInt('DEPLOY_CONCURRENCY', 5))),
  endpointTimeoutMs: readInt('DEPLOY_ENDPOINT_TIMEOUT_MS', 900000),
  stepTimeoutMs: readInt('DEPLOY_STEP_TIMEOUT_MS', 120000),
  stagingPath: process.env.DEPLOY_STAGING_PATH || 'C:\\Windows\\Temp\\deploy',
  maxPackageMb: readInt('DEPLOY_MAX_PACKAGE_MB', 2048),
  bulkConfirmThreshold: readInt('DEPLOY_BULK_CONFIRM_THRESHOLD', 20),
  packageDir: dataRoot,
  syncIntervalHours: readInt('SYNC_INTERVAL_HOURS', 3),
  defaultEnvironment: (process.env.DEFAULT_DEPLOY_ENVIRONMENT || 'rnd').toLowerCase() === 'prod' ? 'prod' : 'rnd',
};
