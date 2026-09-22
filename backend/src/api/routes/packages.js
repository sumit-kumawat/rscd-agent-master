const express = require('express');
const multer = require('multer');
const packageStore = require('../../services/packageStore');
const deployConfig = require('../../config/deployConfig');
const { requireOperator } = require('../../middleware/operatorAuth');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: deployConfig.maxPackageMb * 1024 * 1024 },
});

router.get('/', async (req, res) => {
  const data = await packageStore.listPackages();
  res.json({ success: true, data });
});

router.post('/upload', requireOperator, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'file required' });
    const doc = await packageStore.saveUpload({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      name: req.body.name,
      expectedSha256: req.body.expectedSha256,
      uploadedBy: req.actor || 'system',
    });
    res.status(201).json({
      success: true,
      data: {
        id: doc._id,
        name: doc.name,
        fileName: doc.fileName,
        size: doc.size,
        sha256: doc.sha256,
        packageType: doc.packageType,
        uploadedAt: doc.createdAt,
      },
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.delete('/:id', requireOperator, async (req, res) => {
  const removed = await packageStore.removePackage(req.params.id);
  if (!removed) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true });
});

module.exports = router;
