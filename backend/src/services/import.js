const VM = require('../models/VM');
const Job = require('../models/Job');
const monitor = require('./monitor');
const activityLog = require('./activityLog');
const { deleteVmsWithCleanup } = require('./vmCleanup');
const { queueVmChecks } = require('./vmCheckQueue');
const { isIp } = require('../utils/hosts');

const SKIP_IPS = new Set(['127.0.0.1', '172.26.0.1', '172.17.0.1']);

function parseIp(raw) {
  const ips = String(raw || '').match(/\d+\.\d+\.\d+\.\d+/g) || [];
  const ok = ips.find((ip) => !SKIP_IPS.has(ip) && !ip.startsWith('10.42.'));
  return ok || ips[0] || String(raw || '').trim();
}

function lineToVm(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const host = trimmed.split(/[\s,;|#]/)[0].trim();
  if (!host) return null;

  return {
    name: host,
    fqdn: isIp(host) || !host.includes('.') ? '' : host,
    ip: isIp(host) ? host : '',
    os: 'Windows',
    osType: 'windows',
    version: 'unknown',
    agentStatus: 'active',
    status: 'offline',
    excluded: false,
    environment: 'rnd',
  };
}

function parseTxt(text) {
  const vms = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const vm = lineToVm(line);
    if (!vm || seen.has(vm.name)) continue;
    seen.add(vm.name);
    vms.push(vm);
  }
  return vms;
}

async function saveVms(parsed, { replace = false, io = null } = {}) {
  monitor.pause();
  try {
    if (replace) {
      const existingIds = (await VM.find({}, '_id')).map((v) => v._id);
      if (existingIds.length) await deleteVmsWithCleanup(existingIds, io);
      else await Job.deleteMany({});
    }
    const existing = replace ? new Set() : new Set((await VM.find({}, 'name')).map((v) => v.name));
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const batch = [];
    const newIds = [];
    const updatedIds = [];

    for (const vm of parsed) {
      if (existing.has(vm.name)) {
        if (!replace) {
          const doc = await VM.findOneAndUpdate({ name: vm.name }, { $set: vm }, { new: true });
          if (doc) updatedIds.push(doc._id);
          updated++;
        } else {
          skipped++;
        }
        continue;
      }
      existing.add(vm.name);
      batch.push(vm);
      if (batch.length >= 500) {
        const inserted = await VM.insertMany(batch);
        created += inserted.length;
        newIds.push(...inserted.map((d) => d._id));
        batch.length = 0;
      }
    }
    if (batch.length) {
      const inserted = await VM.insertMany(batch);
      created += inserted.length;
      newIds.push(...inserted.map((d) => d._id));
    }
    await activityLog.write({
      category: 'import',
      level: 'success',
      message: `Import: ${created} new, ${updated} updated, ${skipped} skipped`,
      meta: { total: parsed.length, created, updated, skipped, replace },
    }, io);
    if (io) {
      io.emit('vms:imported', {
        created, updated, skipped, total: parsed.length, replace,
      });
    }
    queueVmChecks([...newIds, ...updatedIds], io);
    return { total: parsed.length, created, updated, skipped, checkQueued: newIds.length + updatedIds.length };
  } finally {
    monitor.resume();
  }
}

function rowToVm(row, col) {
  const host = row[col.host];
  if (!host || host === 'None') return null;
  const installRoot = String(row[col.installRoot] || '').trim();
  if (installRoot.startsWith('/')) return null;
  if (col.osType != null && row[col.osType]) {
    const os = String(row[col.osType]).toLowerCase();
    if (os.includes('linux') || os.includes('unix')) return null;
  }
  const rawIp = col.ip != null ? parseIp(row[col.ip]) : '';
  const ip = rawIp && isIp(rawIp) ? rawIp : '';
  const version = String(row[col.fullVersion] || row[col.productVersion] || 'unknown').trim();
  return {
    name: String(host).trim(),
    fqdn: row[col.fqdn] ? String(row[col.fqdn]).trim() : String(host).trim(),
    ip,
    os: 'Windows',
    osType: 'windows',
    version,
    productVersion: row[col.productVersion] ? String(row[col.productVersion]).trim() : '',
    installRoot: installRoot && installRoot !== 'None' ? installRoot : '',
    site: row[col.site] ? String(row[col.site]).trim() : '',
    agentStatus: 'active',
    status: 'offline',
    excluded: false,
    environment: 'rnd',
  };
}

function indexColumns(header) {
  const col = {};
  header.forEach((h, i) => {
    const k = String(h || '').trim();
    if (k === 'Host') col.host = i;
    if (k === 'Local FQDN') col.fqdn = i;
    if (k === 'Install Root') col.installRoot = i;
    if (k === 'Full Version') col.fullVersion = i;
    if (k === 'Product Version') col.productVersion = i;
    if (k === 'IP Address') col.ip = i;
    if (k === 'Site') col.site = i;
    if (k === 'OS Type') col.osType = i;
  });
  return col;
}

async function importTxt(text, options = {}) {
  const parsed = parseTxt(text);
  const result = await saveVms(parsed, options);
  return result;
}

async function importExcel(buffer, options = {}) {
  const { replace = false } = options;
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const parsed = [];
  for (const sheet of workbook.worksheets) {
    const rows = [];
    sheet.eachRow((row) => rows.push(row.values.slice(1)));
    if (rows.length < 2) continue;
    const col = indexColumns(rows[0]);
    if (col.host == null) continue;
    for (let i = 1; i < rows.length; i++) {
      const vm = rowToVm(rows[i], col);
      if (vm) parsed.push(vm);
    }
  }

  return saveVms(parsed, options);
}

module.exports = { importExcel, importTxt, parseTxt };
