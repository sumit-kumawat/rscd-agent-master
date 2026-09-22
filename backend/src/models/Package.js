const mongoose = require('mongoose');

const packageSchema = new mongoose.Schema(
  {
    tenantId: { type: String, default: 'default', index: true },
    name: { type: String, required: true },
    fileName: { type: String, required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true, index: true },
    expectedSha256: { type: String },
    storagePath: { type: String, required: true },
    packageType: { type: String, enum: ['msi', 'exe', 'unknown'], default: 'unknown' },
    uploadedBy: { type: String, default: 'system' },
  },
  { timestamps: true },
);

packageSchema.index({ name: 'text', fileName: 'text' });

module.exports = mongoose.model('Package', packageSchema);
