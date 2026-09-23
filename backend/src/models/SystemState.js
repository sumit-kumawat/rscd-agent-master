const mongoose = require('mongoose');

const systemStateSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'system' },
    initialSyncDone: { type: Boolean, default: false },
    lastSyncAt: { type: Date },
  },
  { collection: 'system_state', minimize: false },
);

module.exports = mongoose.model('SystemState', systemStateSchema);
