const SystemState = require('../models/SystemState');

async function getState() {
  let doc = await SystemState.findById('system').lean();
  if (!doc) {
    doc = await SystemState.create({ _id: 'system', initialSyncDone: false });
    return doc.toObject ? doc.toObject() : doc;
  }
  return doc;
}

async function setState(patch) {
  const $set = {};
  if (patch.initialSyncDone !== undefined) $set.initialSyncDone = patch.initialSyncDone;
  if (patch.lastSyncAt !== undefined) $set.lastSyncAt = patch.lastSyncAt;
  return SystemState.findByIdAndUpdate(
    'system',
    { $set },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
}

module.exports = {
  getState,
  setState,
};
