const VM = require('../models/VM');
const deployConfig = require('../config/deployConfig');
const { runPool } = require('../utils/pool');
const registrySoftware = require('./registrySoftware');
const deployInstall = require('./deployInstall');
const { decryptIfNeeded } = require('../utils/credentialCrypto');

async function queryProgramsForEndpoint(vm) {
  const plain = { ...vm.toObject(), wmiPassword: decryptIfNeeded(vm.wmiPassword) };
  const session = await deployInstall.sessionFromVm(plain);
  try {
    const { programs } = await registrySoftware.fetchInstalledPrograms(session);
    return { endpointId: vm._id, name: vm.name, ip: vm.ip, ok: true, programs };
  } catch (err) {
    return { endpointId: vm._id, name: vm.name, ip: vm.ip, ok: false, error: err.message, programs: [] };
  }
}

async function queryProgramsParallel(endpointIds, environment) {
  const query = { _id: { $in: endpointIds }, excluded: false };
  if (environment) query.environment = environment;
  const vms = await VM.find(query).select('+wmiPassword');
  const results = await runPool(vms, deployConfig.concurrency, queryProgramsForEndpoint);
  return aggregateProducts(results);
}

function aggregateProducts(endpointResults) {
  const products = new Map();
  for (const ep of endpointResults) {
    for (const p of ep.programs || []) {
      const name = p.displayName || p.name;
      if (!name) continue;
      if (!products.has(name)) {
        products.set(name, {
          productName: name,
          versions: new Map(),
          endpointIds: new Set(),
          classification: registrySoftware.classifyProgram(p),
        });
      }
      const entry = products.get(name);
      const ver = p.version || '(unknown)';
      if (!entry.versions.has(ver)) entry.versions.set(ver, new Set());
      entry.versions.get(ver).add(String(ep.endpointId));
      entry.endpointIds.add(String(ep.endpointId));
    }
  }

  const list = [...products.values()].map((p) => ({
    productName: p.productName,
    classification: p.classification,
    endpointCount: p.endpointIds.size,
    versionCount: p.versions.size,
    versions: [...p.versions.entries()].map(([version, ids]) => ({
      version,
      endpointCount: ids.size,
      endpointIds: [...ids],
    })),
  }));

  list.sort((a, b) => {
    if (a.classification === 'rscd' && b.classification !== 'rscd') return -1;
    if (b.classification === 'rscd' && a.classification !== 'rscd') return 1;
    return b.endpointCount - a.endpointCount;
  });

  return { endpoints: endpointResults, products: list };
}

module.exports = { queryProgramsParallel, aggregateProducts };
