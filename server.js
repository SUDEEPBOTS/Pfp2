// server.js
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS for frontend (simple)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,PUT,DELETE,OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type,x-admin-pass'
  );
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// ensure uploads directory exists (inside public so files are directly reachable)
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// multer storage for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const original = (file.originalname || 'image')
      .toLowerCase()
      .replace(/[^a-z0-9.\-_]+/g, '_');
    const ext = path.extname(original) || '';
    const base = path.basename(original, ext);
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${base}-${unique}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image uploads are allowed'));
    }
    cb(null, true);
  }
});

// connect MongoDB (URL same system)
const MONGO = process.env.MONGODB_URI || '';
if (!MONGO) {
  console.warn('⚠️ MONGODB_URI not set in .env');
}
mongoose
  .connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.warn('❌ MongoDB connect error:', err.message));

// model
const PfpSchema = new mongoose.Schema({
  title: String,
  author: String,
  url: String,
  cat: { type: String, default: 'top' },
  tags: [String],
  createdAt: { type: Date, default: Date.now }
});
const Pfp = mongoose.model('Pfp', PfpSchema);

// simple admin password check (header x-admin-pass)
function checkAdmin(req) {
  const pass = (req.headers['x-admin-pass'] || '').toString();
  return pass && ADMIN_PASSWORD && pass === ADMIN_PASSWORD;
}

/* ===== API: PFP items ===== */

// list all pfps (newest first)
app.get('/api/pfps', async (req, res) => {
  try {
    const items = await Pfp.find().sort({ createdAt: -1 }).lean();
    return res.json({ ok: true, items });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// add new pfp (admin only)
app.post('/api/pfps', async (req, res) => {
  try {
    if (!checkAdmin(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const { title, author, url, cat, tags } = req.body;
    if (!title || !url) {
      return res
        .status(400)
        .json({ ok: false, error: 'title and url required' });
    }
    const doc = new Pfp({
      title,
      author: author || 'unknown',
      url,
      cat: cat || 'top',
      tags: tags || []
    });
    await doc.save();
    return res.json({ ok: true, item: doc });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// update pfp (admin only)
app.put('/api/pfps/:id', async (req, res) => {
  try {
    if (!checkAdmin(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const { title, author, url, cat, tags } = req.body;
    const updates = {};
    if (title) updates.title = title;
    if (author) updates.author = author;
    if (url) updates.url = url;
    if (cat) updates.cat = cat;
    if (Array.isArray(tags)) updates.tags = tags;
    const doc = await Pfp.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true }
    );
    return res.json({ ok: true, item: doc });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// delete pfp (admin only)
app.delete('/api/pfps/:id', async (req, res) => {
  try {
    if (!checkAdmin(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    await Pfp.findByIdAndDelete(req.params.id);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/* ===== API: Image upload + gallery ===== */

// upload image (admin only)
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!checkAdmin(req)) {
      // delete file if unauthorized
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {}
      }
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No file uploaded' });
    }

    const url = '/uploads/' + req.file.filename;
    return res.json({
      ok: true,
      url,
      filename: req.file.filename
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// list uploaded images as gallery
app.get('/api/gallery', (req, res) => {
  fs.readdir(UPLOAD_DIR, (err, files) => {
    if (err) {
      return res.json({ ok: true, items: [] });
    }
    const items =
      (files || [])
        .filter(name => name && !name.startsWith('.'))
        .map(name => ({
          url: '/uploads/' + name,
          name
        })) || [];
    return res.json({ ok: true, items });
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () =>
  console.log(`🚀 Server listening on http://localhost:${PORT}`)
);
