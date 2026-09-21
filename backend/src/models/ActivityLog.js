const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, default: Date.now, index: true },
    level: { type: String, enum: ['info', 'success', 'warning', 'error', 'debug'], default: 'info', index: true },
    category: {
      type: String,
      enum: ['vm', 'job', 'monitor', 'import', 'system', 'provision', 'power', 'wmi', 'console', 'audit'],
      default: 'system',
      index: true,
    },
    message: { type: String, required: true },
    actor: { type: String, default: 'system', index: true },
    tenant: { type: String, default: 'default', index: true },
    action: { type: String, index: true },
    status: { type: String, enum: ['started', 'success', 'failed', 'retry', 'info'], default: 'info', index: true },
    durationMs: { type: Number, default: null },
    vmId: { type: mongoose.Schema.Types.ObjectId, ref: 'VM', index: true },
    vmName: String,
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
    meta: mongoose.Schema.Types.Mixed,
  },
  { timestamps: false }
);

activityLogSchema.index({ timestamp: -1 });
activityLogSchema.index({ vmId: 1, timestamp: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
