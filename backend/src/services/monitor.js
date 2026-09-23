const VM = require('../models/VM');
const { checkVmRecord } = require('./vmCheckQueue');
const activityLog = require('./activityLog');
const logger = require('../utils/logger');
const { runPool } = require('../utils/pool');
const { getMonitorableVmQuery } = require('../utils/agentStatus');
const wmiConfig = require('../config/wmi');
const { CONNECTIVITY_STATES } = require('../utils/wmiCredentials');

const BACKOFF_STATES = new Set([
  CONNECTIVITY_STATES.AUTH_FAILED,
  CONNECTIVITY_STATES.TIMEOUT,
  CONNECTIVITY_STATES.UNREACHABLE,
  CONNECTIVITY_STATES.RELAY_UNAVAILABLE,
  CONNECTIVITY_STATES.WMI_UNAVAILABLE,
  CONNECTIVITY_STATES.PERMISSION_DENIED,
  CONNECTIVITY_STATES.DNS_FAILED,
  CONNECTIVITY_STATES.UNKNOWN,
  CONNECTIVITY_STATES.OFFLINE,
]);

function shouldSkipProbe(vm) {
  const backoffSec = wmiConfig.monitorProbeBackoffSec;
  if (!backoffSec || backoffSec <= 0) return false;
  if (!vm.lastCheck || !vm.connectivityState) return false;
  if (vm.connectivityState === CONNECTIVITY_STATES.ONLINE) return false;
  if (!BACKOFF_STATES.has(vm.connectivityState)) return false;
  const elapsed = Date.now() - new Date(vm.lastCheck).getTime();
  return elapsed < backoffSec * 1000;
}

class MonitorService {
  constructor() {
    this.timer = null;
    this.running = false;
    this.paused = false;
    this.io = null;
    this.skippedLastCycle = 0;
  }

  start(io, options = {}) {
    if (this.timer) return;
    this.io = io;
    const sec = parseInt(
      process.env.CONNECTIVITY_CHECK_INTERVAL_SECONDS || process.env.MONITOR_INTERVAL_SEC || '30',
      10,
    );
    const backoff = wmiConfig.monitorProbeBackoffSec;
    logger.info(
      `Monitor started (every ${sec}s, concurrency ${process.env.MONITOR_CONCURRENCY || 30}, `
      + `probe backoff ${backoff}s for failed VMs)`,
    );
    if (options.deferInitialRun !== true) {
      this.run();
    }
    this.timer = setInterval(() => this.run(), sec * 1000);
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; }

  /** Immediate check on boot — bypasses failure backoff so VMs recover without manual scripts. */
  async startupSweep() {
    if (!wmiConfig.startupCheckOnBoot) return;
    logger.info('Startup VM connectivity sweep (lightweight, bypass backoff)');
    await this.run({ force: true });
  }

  async run(options = {}) {
    if (this.running || this.paused) return;
    this.running = true;
    const force = options.force === true;
    let onlineCount = 0;
    let skipped = 0;
    try {
      const vms = await VM.find(getMonitorableVmQuery()).select('+wmiPassword').lean();
      const concurrency = parseInt(process.env.MONITOR_CONCURRENCY || '30', 10);

      await runPool(vms, concurrency, async (vm) => {
        if (!force && shouldSkipProbe(vm)) {
          skipped++;
          if (vm.status === 'online') onlineCount++;
          logger.debug(
            `Monitor skip ${vm.name}: backoff (${vm.connectivityState}, `
            + `last check ${Math.round((Date.now() - new Date(vm.lastCheck).getTime()) / 1000)}s ago)`,
          );
          return;
        }
        try {
          const updated = await checkVmRecord(vm, this.io, { lightweight: true });
          if (!updated) return;
          if (updated.status === 'online') onlineCount++;
        } catch (err) {
          logger.debug(`Monitor ${vm.name}: ${err.message}`);
        }
      });

      this.skippedLastCycle = skipped;
      if (vms.length) {
        const notOnline = vms.length - onlineCount;
        const skipNote = skipped ? `, ${skipped} skipped (backoff)` : '';
        logger.info(
          `Monitor: ${vms.length} Windows VMs checked, ${onlineCount} online, `
          + `${notOnline} not online${skipNote}`,
        );
        activityLog.write({
          category: 'monitor',
          level: 'info',
          message: `Checked ${vms.length} VM(s) — ${onlineCount} online`,
          meta: { total: vms.length, online: onlineCount, skipped },
        }, this.io).catch(() => {});
      }
      this.io?.emit('monitor:cycle', { count: vms.length, skipped });
    } finally {
      this.running = false;
    }
  }
}

module.exports = new MonitorService();
