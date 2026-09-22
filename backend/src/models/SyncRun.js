const mongoose = require('mongoose');

const syncRunSchema = new mongoose.Schema(
  {
    environment: { type: String, enum: ['rnd', 'prod', 'all'], default: 'all', index: true },
    trigger: { type: String, enum: ['boot', 'scheduled', 'manual', 'login'], default: 'manual' },
    startedAt: { type: Date, default: Date.now, index: true },
    endedAt: Date,
    endpointsScanned: { type: Number, default: 0 },
    succeeded: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    durationMs: Number,
  },
  { timestamps: true },
);

module.exports = mongoose.model('SyncRun', syncRunSchema);
