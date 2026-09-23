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
    connectivityState: {
      type: String,
      enum: [
        'online', 'in_progress', 'auth_failed', 'timeout', 'unreachable', 'relay_unavailable',
        'wmi_unavailable', 'permission_denied', 'dns_failed', 'offline', 'unknown',
      ],
      default: 'unknown',
      index: true,
    },
    powerState: { type: String, enum: ['on', 'off', 'unknown'], default: 'unknown', index: true },
    lastSeenAt: { type: Date },
    serviceTag: { type: String, default: '' },
    hardwareModel: { type: String, default: '' },
    osVersion: { type: String, default: '' },
    localUsers: {
      required: { type: Number, default: 3 },
      present: { type: Number, default: 0 },
      checkedAt: { type: Date },
      users: [{
        name: String,
        present: Boolean,
        enabled: Boolean,
        groups: [String],
        lastLogin: Date,
      }],
    },
    lastCheck: { type: Date, default: Date.now },
    lastFullSyncAt: { type: Date, index: true },
    lastProbeError: { type: String, default: '' },
    wmiDomain: { type: String, default: '' },
    wmiUsername: { type: String, default: '' },
    wmiPassword: { type: String, default: '', select: false },
    wmiReachable: { type: Boolean, default: false },
    authStatus: { type: String, enum: ['allowed', 'denied', 'unknown'], default: 'unknown', index: true },
    connectivityMethod: { type: String, enum: ['wmi', 'none'], default: 'none' },
    rebootRequired: { type: Boolean, default: false },
    excluded: { type: Boolean, default: false },
    environment: { type: String, enum: ['rnd', 'prod'], default: 'rnd', index: true },
    rscdStatus: { type: String, enum: ['installed', 'absent', 'unknown'], default: 'unknown', index: true },
    rscdVersion: { type: String, default: '' },
    crowdStrikeStatus: { type: String, enum: ['installed', 'absent', 'unknown'], default: 'unknown', index: true },
    crowdStrikeVersion: { type: String, default: '' },
    vcRedist2015X64: {
      status: { type: String, enum: ['installed', 'missing', 'failed', 'unknown'], default: 'unknown' },
      version: { type: String, default: '' },
      checkedAt: { type: Date },
    },
    readiness: {
      checkedAt: { type: Date },
      allPass: { type: Boolean, default: false },
      tasks: [{
        id: String,
        status: { type: String, enum: ['pass', 'fail', 'unknown'] },
        message: String,
      }],
    },
    softwareSnapshot: {
      capturedAt: Date,
      programCount: { type: Number, default: 0 },
      programs: [{
        name: String,
        version: String,
        publisher: String,
        uninstallString: String,
        quietUninstallString: String,
        architecture: String,
      }],
    },
  },
  { timestamps: true }
);

vmSchema.index({ name: 'text', ip: 'text', fqdn: 'text' });
vmSchema.index({ environment: 1, status: 1 });

vmSchema.pre('save', function encryptCredentials(next) {
  try {
    const { encryptIfNeeded } = require('../utils/credentialCrypto');
    if (this.isModified('wmiPassword') && this.wmiPassword) {
      this.wmiPassword = encryptIfNeeded(this.wmiPassword);
    }
  } catch {
    // keep plaintext if encryption unavailable
  }
  next();
});

module.exports = mongoose.model('VM', vmSchema);
