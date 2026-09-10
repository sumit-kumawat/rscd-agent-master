require('dotenv').config();
const mongoose = require('mongoose');
const VM = require('./models/VM');
const KeepVersion = require('./models/KeepVersion');
const Job = require('./models/Job');
const Log = require('./models/Log');

const seed = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://admin:password@localhost:27017/rscd_agent_master?authSource=admin';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  await Promise.all([
    VM.deleteMany({}),
    KeepVersion.deleteMany({}),
    Job.deleteMany({}),
    Log.deleteMany({}),
  ]);

  console.log('Database cleared: VMs, jobs, logs, keep versions');
  console.log('OS credentials (WMI): rdsroot / 1Rs50U$D (fallback: rdsmon / D0N0harm)');
  await mongoose.disconnect();
};

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
