const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    vms: [{ type: mongoose.Schema.Types.ObjectId, ref: 'VM' }],
    config: {
      testMode: { type: Boolean, default: false },
      belowVersion: { type: String },
    },
    statistics: {
      total: { type: Number, default: 0 },
      success: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
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
