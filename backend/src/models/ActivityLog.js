const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, default: Date.now, index: true },
    level: { type: String, enum: ['info', 'success', 'warning', 'error', 'debug'], default: 'info', index: true },
    category: { type: String, enum: ['vm', 'job', 'monitor', 'import', 'system'], default: 'system', index: true },
    message: { type: String, required: true },
    vmId: { type: mongoose.Schema.Types.ObjectId, ref: 'VM' },
    vmName: String,
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
    meta: mongoose.Schema.Types.Mixed,
  },
  { timestamps: false }
);

activityLogSchema.index({ timestamp: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
