const mongoose = require('mongoose');

const endpointResultSchema = new mongoose.Schema({
  endpointId: { type: mongoose.Schema.Types.ObjectId, ref: 'VM' },
  name: String,
  ip: String,
  environment: { type: String, enum: ['rnd', 'prod'], default: 'rnd' },
  agentName: String,
  agentVersion: String,
  status: {
    type: String,
    enum: [
      'queued', 'connecting', 'detecting', 'stopping', 'transferring', 'verifying',
      'installing', 'uninstalling', 'cleaning', 'rebooting', 'done', 'failed', 'skipped', 'cancelled',
    ],
    default: 'queued',
  },
  step: String,
  message: String,
  startedAt: Date,
  endedAt: Date,
  durationMs: Number,
}, { _id: false });

const jobSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ['uninstall_rscd', 'uninstall_program', 'install_package', 'provision', 'legacy_uninstall'],
      default: 'legacy_uninstall',
      index: true,
    },
    environment: { type: String, enum: ['rnd', 'prod'], default: 'rnd', index: true },
    tenantId: { type: String, default: 'default', index: true },
    userId: { type: String, default: 'system' },
    packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Package' },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    vms: [{ type: mongoose.Schema.Types.ObjectId, ref: 'VM' }],
    endpointResults: [endpointResultSchema],
    config: {
      testMode: { type: Boolean, default: false },
      belowVersion: { type: String },
      productName: String,
      productVersions: [String],
      target: { type: String, enum: ['rscd', 'crowdstrike', 'custom'], default: 'custom' },
      options: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    statistics: {
      total: { type: Number, default: 0 },
      success: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
      cancelled: { type: Number, default: 0 },
    },
    progress: { type: Number, default: 0 },
    startedAt: Date,
    completedAt: Date,
    logs: [
      {
        timestamp: { type: Date, default: Date.now },
        level: { type: String, enum: ['info', 'success', 'warning', 'error'], default: 'info' },
        message: String,
        vm: String,
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Job', jobSchema);
