const mongoose = require('mongoose');

const vmSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, index: true },
    fqdn: { type: String },
    ip: { type: String, default: '' },
    os: { type: String, default: 'Windows' },
    osType: { type: String, enum: ['windows'], default: 'windows' },
    version: { type: String, default: 'unknown', index: true },
    productVersion: { type: String },
    installRoot: { type: String },
    site: { type: String },
    agentStatus: {
      type: String,
      enum: ['active', 'removed'],
      default: 'active',
      index: true,
    },
    status: {
      type: String,
      enum: ['online', 'offline', 'in_progress', 'excluded'],
      default: 'offline',
      index: true,
    },
    lastCheck: { type: Date, default: Date.now },
    lastProbeError: { type: String, default: '' },
    wmiDomain: { type: String, default: '' },
    wmiUsername: { type: String, default: '' },
    wmiPassword: { type: String, default: '', select: false },
    wmiReachable: { type: Boolean, default: false },
    connectivityMethod: { type: String, enum: ['wmi', 'none'], default: 'none' },
    excluded: { type: Boolean, default: false },
  },
  { timestamps: true }
);

vmSchema.index({ name: 'text', ip: 'text', fqdn: 'text' });

module.exports = mongoose.model('VM', vmSchema);
