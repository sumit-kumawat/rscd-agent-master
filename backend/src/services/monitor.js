const VM = require('../models/VM');
const connectivity = require('./connectivity');
const activityLog = require('./activityLog');
const logger = require('../utils/logger');
const { runPool } = require('../utils/pool');
const { getMonitorableVmQuery } = require('../utils/agentStatus');

class MonitorService {
  constructor() {
    this.timer = null;
    this.running = false;
    this.paused = false;
    this.io = null;
  }

  start(io) {
    if (this.timer) return;
    this.io = io;
    const sec = parseInt(process.env.MONITOR_INTERVAL_SEC || '30', 10);
    logger.info(`Monitor started (every ${sec}s, concurrency ${process.env.MONITOR_CONCURRENCY || 30})`);
    this.run();
    this.timer = setInterval(() => this.run(), sec * 1000);
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; }

  async run() {
    if (this.running || this.paused) return;
    this.running = true;
    let onlineCount = 0;
    try {
      const vms = await VM.find(getMonitorableVmQuery()).select('+wmiPassword').lean();
      const concurrency = parseInt(process.env.MONITOR_CONCURRENCY || '30', 10);

      await runPool(vms, concurrency, async (vm) => {
        try {
          const { result, vm: updated } = await connectivity.checkAndUpdate(vm);
          if (!updated) return;
          if (updated.status === 'online') onlineCount++;
          this.io?.emit('vm:status', {
            vmId: updated._id,
            name: updated.name,
            status: updated.status,
            connectivity: result.connectivity,
            agentStatus: updated.agentStatus,
            ip: updated.ip,
            version: updated.version,
            lastCheck: updated.lastCheck,
          });
        } catch (err) {
          logger.debug(`Monitor ${vm.name}: ${err.message}`);
        }
      });

      if (vms.length) {
        logger.info(`Monitor: ${vms.length} Windows VMs checked, ${onlineCount} online`);
        activityLog.write({
          category: 'monitor',
          level: 'info',
          message: `Checked ${vms.length} VM(s) — ${onlineCount} online`,
          meta: { total: vms.length, online: onlineCount },
        }, this.io).catch(() => {});
      }
      this.io?.emit('monitor:cycle', { count: vms.length });
    } finally {
      this.running = false;
    }
  }
}

module.exports = new MonitorService();
