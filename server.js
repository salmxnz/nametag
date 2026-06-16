const express    = require('express');
const multer     = require('multer');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');
const puppeteer  = require('puppeteer-core');
const { PDFDocument } = require('pdf-lib');

const app  = express();
// export-all with 95 nametags can take several minutes — keep the socket alive
app.use((req, res, next) => {
  if (req.path === '/api/export-all') {
    res.setTimeout(600000);
    req.setTimeout(600000);
  }
  next();
});
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
    if (n <= 3)  return '24px';
    if (n <= 7)  return '21px';
    if (n <= 11) return '17px';
    if (n <= 15) return '14px';
    return '12px';
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
      <div style="flex:0.75"></div>
      <div class="chackers">
        <div class="cident">
          <div class="pname" style="font-size:${nameSize(p.name.length)}">${p.name}</div>
          <div class="porg">${teamName}</div>
          <div class="logo-ring">${logoHtml}</div>
        </div>
        <img class="himg hleft"  src="photos/hacket-left.webp" alt="">
        <img class="himg hright" src="photos/hacker-right.webp" alt="">
      </div>
      <div class="cfooter">
        <img src="photos/doppler-ai.webp"            class="fl" alt="Doppler AI">
        <img src="photos/Emtel_Logo.png"             class="fl" alt="Emtel">
        <img src="photos/CC-logo.webp"               class="fl" alt="Computer Club">
        <img src="photos/su-logo-hovered.png"        class="fl" alt="SU">
        <img src="photos/uom-logo.png"               class="fl" style="height:24px;max-width:38px" alt="UoM">
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
/* trim 60×90mm + 10mm (1cm) bleed all sides = page 80×110mm */
@page{margin:0;size:80mm 110mm}
html,body{width:80mm;background:#000;overflow:hidden;margin:0;padding:0}
.card{
  width:80mm;height:110mm;
  position:relative;overflow:hidden;
  display:flex;flex-direction:column;
  background:linear-gradient(to bottom,rgba(0,0,0,.72) 0%,rgba(0,0,0,0) 55%),url('photos/bg.jpg') center/cover no-repeat #000;
  page-break-after:always;break-after:page;
}
.lhole{width:14px;height:7px;border-radius:7px;position:absolute;top:6px;left:50%;transform:translateX(-50%);z-index:20;border:2px solid rgba(255,255,255,.12);background:rgba(0,0,0,.7)}
.ctop{padding:16mm 14px 0;display:flex;align-items:center;justify-content:center;flex-shrink:0;position:relative;z-index:2;background:transparent}
.nxlogo{height:10px;width:auto;filter:grayscale(1) brightness(6);opacity:.85}
.cspacer{flex:1}
.ctitle{padding:0 11px 0;text-align:center;flex-shrink:0;position:relative;z-index:2}
.tsf{display:block;font-family:'Arial Black','Arial Bold',Arial,sans-serif;font-size:11px;font-weight:900;letter-spacing:.5px;color:rgba(255,255,255,.9);margin-bottom:3px}
.thack-img{display:block;width:100%;max-width:160px;height:auto;margin:0 auto}
.chackers{position:relative;overflow:hidden;height:128px;flex-shrink:0}
.himg{position:absolute;bottom:0;height:100px;width:auto;mix-blend-mode:screen;z-index:2}
.hleft{left:-4px}
.hright{right:-4px}
.chackers::after{display:none}
.cident{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding-top:2px;gap:2px;z-index:10}
.pname{font-family:'Rajdhani',sans-serif;font-weight:700;font-size:19px;letter-spacing:2px;line-height:1;color:#fff}
.porg{font-family:'Syne',sans-serif;font-size:5px;font-weight:400;letter-spacing:5px;text-transform:uppercase;color:rgba(160,150,255,.8)}
.logo-ring{width:64px;height:64px;border-radius:11px;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;background:rgba(130,120,248,.15);border:1px solid rgba(130,120,248,.4);margin-top:3px}
.logo-img{width:100%;height:100%;object-fit:contain;padding:4px}
.logo-photo{object-fit:cover;padding:0}
.logo-init{font-family:'Orbitron',monospace;font-size:12px;font-weight:900;letter-spacing:1px;text-align:center;color:#a78bfa}
.cfooter{height:23mm;display:flex;align-items:center;justify-content:center;gap:10px;padding:0 0 10mm;flex-shrink:0;position:relative;z-index:2;background:#fff;border-top:none}
.fl{height:20px;width:auto;max-width:32px;object-fit:contain}
</style>
</head><body>${cards}</body></html>`);
});

// ── Bulk PDF export ───────────────────────────────────
app.get('/api/export-all', async (_req, res) => {
  try {
    const db = read();
    if (!db.participants.length) return res.status(400).json({ error: 'No participants' });

    const PORT_ = process.env.PORT || 3000;
    const chromiumPaths = [
      process.env.CHROMIUM_PATH,
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
    ].filter(Boolean);
    const executablePath = chromiumPaths.find(p => { try { return fs.existsSync(p); } catch { return false; } });
    if (!executablePath) return res.status(500).json({ error: 'No Chromium found. Set CHROMIUM_PATH env var.' });

    const browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(600000);
      // use 127.0.0.1 to avoid DNS resolution issues inside the container
      await page.goto(`http://127.0.0.1:${PORT_}/print-all`, {
        waitUntil: 'domcontentloaded',
        timeout: 600000,
      });

      // wait for every <img> to actually finish loading (decode included)
      await page.evaluate(async () => {
        const imgs = [...document.images];
        await Promise.all(imgs.map(im => {
          if (im.complete && im.naturalWidth) return;
          return new Promise(res => {
            im.addEventListener('load', res, { once: true });
            im.addEventListener('error', res, { once: true });
          });
        }));
        // also wait for fonts
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
      });

      const pdfBytes = await page.pdf({
        width:  '80mm',
        height: '110mm',
        printBackground: true,
        timeout: 600000,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="all_nametags.pdf"');
      res.end(pdfBytes);
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.error('export-all error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
