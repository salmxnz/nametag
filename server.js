const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

const app  = express();
const DB   = path.join(__dirname, 'data', 'db.json');
const LOGO = path.join(__dirname, 'photos', 'team-logos');

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, LOGO),
    filename:    (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, crypto.randomUUID() + ext);
    }
  }),
  fileFilter: (_req, file, cb) => {
    cb(null, /^image\//.test(file.mimetype));
  }
});

app.use(express.json());
app.use(express.static(__dirname));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'nametag-generator.html')));

const read  = () => JSON.parse(fs.readFileSync(DB, 'utf8'));
const write = d  => fs.writeFileSync(DB, JSON.stringify(d, null, 2));
const uid   = () => crypto.randomUUID().slice(0, 8);

// ── Data bootstrap ────────────────────────────────────
if (!fs.existsSync(DB)) write({ teams: [], participants: [] });

// ── API: full state ───────────────────────────────────
app.get('/api/data', (_req, res) => res.json(read()));

// ── Teams ─────────────────────────────────────────────
app.post('/api/teams', upload.single('logo'), (req, res) => {
  const db   = read();
  const team = { id: uid(), name: req.body.name, logo: req.file ? 'photos/team-logos/' + req.file.filename : null };
  db.teams.push(team);
  write(db);
  res.json(team);
});

app.put('/api/teams/:id', upload.single('logo'), (req, res) => {
  const db = read();
  const t  = db.teams.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  t.name = req.body.name ?? t.name;
  if (req.file) {
    if (t.logo) fs.unlink(path.join(__dirname, t.logo), () => {});
    t.logo = 'photos/team-logos/' + req.file.filename;
  }
  write(db);
  res.json(t);
});

app.delete('/api/teams/:id', (req, res) => {
  const db = read();
  const t  = db.teams.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  if (t.logo) fs.unlink(path.join(__dirname, t.logo), () => {});
  db.teams        = db.teams.filter(t => t.id !== req.params.id);
  db.participants = db.participants.filter(p => p.teamId !== req.params.id);
  write(db);
  res.json({ ok: true });
});

// ── Participants ──────────────────────────────────────
app.post('/api/participants', (req, res) => {
  const db = read();
  const p  = { id: uid(), name: req.body.name, teamId: req.body.teamId };
  db.participants.push(p);
  write(db);
  res.json(p);
});

app.put('/api/participants/:id', (req, res) => {
  const db = read();
  const p  = db.participants.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  p.name   = req.body.name   ?? p.name;
  p.teamId = req.body.teamId ?? p.teamId;
  write(db);
  res.json(p);
});

app.delete('/api/participants/:id', (req, res) => {
  const db        = read();
  db.participants = db.participants.filter(p => p.id !== req.params.id);
  write(db);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
