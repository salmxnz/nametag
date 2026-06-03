const express    = require('express');
const multer     = require('multer');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');
const puppeteer  = require('puppeteer');
const { PDFDocument } = require('pdf-lib');

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

// ── Bulk PDF export ───────────────────────────────────
// ── Bulk print page (Puppeteer renders this) ──────────
app.get('/print-all', (_req, res) => {
  const db = read();

  const initials = s => s.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const nameSize = n => {
    if (n <= 3)  return '36px';
    if (n <= 7)  return '31px';
    if (n <= 11) return '25px';
    if (n <= 15) return '21px';
    return '17px';
  };

  const cards = db.participants.map((p) => {
    const team     = db.teams.find(t => t.id === p.teamId);
    const teamName = team ? team.name : '';
    const initStr  = team ? initials(team.name) : '?';
    const logoHtml = team?.logo
      ? `<img class="logo-img logo-photo" src="${team.logo}" alt="">`
      : `<span class="logo-init">${initStr}</span>`;

    return `<div class="card">
      <div class="lhole"></div>
      <div class="ctop"><img src="photos/nexavenu-logo.png" class="nxlogo" alt="Nexavenu"></div>
      <div class="cspacer"></div>
      <div class="ctitle">
        <span class="tsf">Agentforce</span>
        <img src="photos/hackathon.png" class="thack-img" alt="HACKATHON">
      </div>
      <div style="flex:0.4"></div>
      <div class="chackers">
        <div class="cident">
          <div class="pname" style="font-size:${nameSize(p.name.length)}">${p.name}</div>
          <div class="porg">${teamName}</div>
          <div class="logo-ring">${logoHtml}</div>
        </div>
        <img class="himg hleft"  src="photos/hacket-left.png" alt="">
        <img class="himg hright" src="photos/hacker-right.png" alt="">
      </div>
      <div class="cfooter">
        <img src="photos/su-logo-hovered.png"        class="fl" alt="SU">
        <img src="photos/Emtel_Logo.png"             class="fl" alt="Emtel">
        <img src="photos/CC-logo.webp"               class="fl" alt="Computer Club">
        <img src="photos/uilo-ai-upscaled-trans.png" class="fl" alt="UILO">
        <img src="photos/doppler-ai.webp"            class="fl" alt="Doppler AI">
        <img src="photos/uom-logo.png"               class="fl" style="height:36px;max-width:58px" alt="UoM">
      </div>
    </div>`;
  }).join('\n');

  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Rajdhani:wght@500;600;700&family=Syne:wght@300;400;600;700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}
@page{margin:0;size:340px 490px}
html,body{width:340px;background:#000;overflow:hidden}
.card{
  width:340px;height:490px;
  position:relative;overflow:hidden;
  display:flex;flex-direction:column;
  background:linear-gradient(to bottom,rgba(0,0,0,.72) 0%,rgba(0,0,0,0) 55%),url('photos/bg.jpg') center/cover no-repeat;
  page-break-after:always;break-after:page;
}
.lhole{width:20px;height:10px;border-radius:10px;position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:20;border:2px solid rgba(255,255,255,.12);background:rgba(0,0,0,.7)}
.ctop{padding:56px 20px 0;display:flex;align-items:center;justify-content:center;flex-shrink:0;position:relative;z-index:2;background:transparent}
.nxlogo{height:14px;width:auto;filter:grayscale(1) brightness(6);opacity:.85}
.cspacer{flex:1}
.ctitle{padding:0 16px 0;text-align:center;flex-shrink:0;position:relative;z-index:2}
.tsf{display:block;font-family:'Arial Black','Arial Bold',Arial,sans-serif;font-size:16px;font-weight:900;letter-spacing:.5px;color:rgba(255,255,255,.9);margin-bottom:4px}
.thack-img{display:block;width:100%;max-width:238px;height:auto;margin:0 auto}
.chackers{position:relative;overflow:hidden;height:190px;flex-shrink:0}
.himg{position:absolute;bottom:0;height:148px;width:auto;mix-blend-mode:screen;z-index:2}
.hleft{left:-6px}
.hright{right:-6px}
.chackers::after{display:none}
.cident{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding-top:2px;gap:3px;z-index:10}
.pname{font-family:'Rajdhani',sans-serif;font-weight:700;font-size:28px;letter-spacing:3px;line-height:1;color:#fff}
.porg{font-family:'Syne',sans-serif;font-size:7px;font-weight:400;letter-spacing:5px;text-transform:uppercase;color:rgba(160,150,255,.8)}
.logo-ring{width:96px;height:96px;border-radius:16px;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;background:rgba(130,120,248,.15);border:1px solid rgba(130,120,248,.4);margin-top:4px}
.logo-img{width:100%;height:100%;object-fit:contain;padding:6px}
.logo-photo{object-fit:cover;padding:0}
.logo-init{font-family:'Orbitron',monospace;font-size:18px;font-weight:900;letter-spacing:1px;text-align:center;color:#a78bfa}
.cfooter{height:75px;display:flex;align-items:center;justify-content:space-evenly;gap:0;padding:0 10px;flex-shrink:0;position:relative;z-index:2;background:#fff;border-top:none}
.fl{height:30px;width:auto;max-width:48px;object-fit:contain}
</style>
</head><body>${cards}</body></html>`);
});

// ── Bulk PDF export ───────────────────────────────────
app.get('/api/export-all', async (_req, res) => {
  const db = read();
  if (!db.participants.length) return res.status(400).json({ error: 'No participants' });

  const PORT_ = process.env.PORT || 3000;
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT_}/print-all`, { waitUntil: 'networkidle0' });

    const pdfBytes = await page.pdf({
      width:  '340px',
      height: '490px',
      printBackground: true,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="all_nametags.pdf"');
    res.end(pdfBytes);
  } finally {
    await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
