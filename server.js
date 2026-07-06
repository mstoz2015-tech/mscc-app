const express = require("express");
const cors = require("cors");
const path = require("path");
const Database = require("better-sqlite3");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const app = express();
const PORT = 3456;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// SQLite setup
const db = new Database(path.join(__dirname, "mscc.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS senders (
    id TEXT PRIMARY KEY, name TEXT, smtp TEXT, port INTEGER,
    usr TEXT, pass TEXT, sender_name TEXT, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY, name TEXT, sender_id TEXT,
    subject TEXT, body TEXT, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT,
    sent INTEGER DEFAULT 0, opens INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT,
    email_to TEXT, subject TEXT, body TEXT, status TEXT DEFAULT 'pending',
    created_at TEXT
  );
`);

// Seed default senders if empty
const senderCount = db.prepare("SELECT COUNT(*) as c FROM senders").get().c;
if (senderCount === 0) {
  const insert = db.prepare("INSERT INTO senders VALUES (?,?,?,?,?,?,?,?)");
  insert.run("vendirect", "Vendirect.lu", "smtp.stackmail.com", 465, "hello@vendirect.lu", "Schouwi@9696!", "Martin", new Date().toISOString());
  insert.run("together", "Together Immo", "smtp.stackmail.com", 465, "martin@together-immo.lu", "London@2003!", "Martin", new Date().toISOString());
}

function hashEmail(email) {
  return crypto.createHash("sha256").update(email).digest("hex").substring(0, 12);
}

// === API ROUTES ===

// Senders
app.get("/api/senders", (req, res) => {
  res.json(db.prepare("SELECT * FROM senders ORDER BY name").all());
});
app.post("/api/senders", (req, res) => {
  const s = req.body;
  db.prepare("INSERT OR REPLACE INTO senders VALUES (?,?,?,?,?,?,?,?)").run(s.id, s.name, s.smtp, s.port, s.usr, s.pass, s.sender_name, new Date().toISOString());
  res.json({ ok: true });
});
app.delete("/api/senders/:id", (req, res) => {
  db.prepare("DELETE FROM senders WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Campaigns
app.get("/api/campaigns", (req, res) => {
  const camps = db.prepare("SELECT c.*, COALESCE(s.sent,0) as sent, COALESCE(s.opens,0) as opens, COALESCE(s.clicks,0) as clicks FROM campaigns c LEFT JOIN stats s ON s.campaign_id = c.id ORDER BY c.updated_at DESC").all();
  res.json(camps);
});
app.post("/api/campaigns", (req, res) => {
  const c = req.body;
  db.prepare("INSERT OR REPLACE INTO campaigns VALUES (?,?,?,?,?,?,?)").run(c.id, c.name, c.sender_id, c.subject, c.body, c.created_at || new Date().toISOString(), new Date().toISOString());
  db.prepare("INSERT OR IGNORE INTO stats (campaign_id) VALUES (?)").run(c.id);
  res.json({ ok: true });
});
app.delete("/api/campaigns/:id", (req, res) => {
  db.prepare("DELETE FROM campaigns WHERE id = ?").run(req.params.id);
  db.prepare("DELETE FROM stats WHERE campaign_id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Queue
app.get("/api/queue", (req, res) => {
  const items = db.prepare("SELECT * FROM queue WHERE status = 'pending' ORDER BY id").all();
  const byCampaign = {};
  items.forEach(i => {
    if (!byCampaign[i.campaign_id]) byCampaign[i.campaign_id] = [];
    byCampaign[i.campaign_id].push(i);
  });
  const active = {};
  Object.entries(byCampaign).forEach(([cid, items]) => {
    active[cid] = { items: items.length, sending: false };
  });
  res.json({ queue: active });
});
app.post("/api/queue", (req, res) => {
  const { campaign_id, emails } = req.body;
  const insert = db.prepare("INSERT INTO queue (campaign_id, email_to, subject, body, created_at) VALUES (?,?,?,?,?)");
  const now = new Date().toISOString();
  for (const e of emails) {
    insert.run(campaign_id, e.to, e.subject, e.body, now);
  }
  res.json({ queued: emails.length });
});
app.delete("/api/queue/:campaignId", (req, res) => {
  db.prepare("DELETE FROM queue WHERE campaign_id = ? AND status = 'pending'").run(req.params.campaignId);
  res.json({ ok: true });
});

// Send one email (called by frontend timer or manual trigger)
app.post("/api/send-one", async (req, res) => {
  const { campaign_id } = req.body;
  const item = db.prepare("SELECT * FROM queue WHERE campaign_id = ? AND status = 'pending' ORDER BY id LIMIT 1").get(campaign_id);
  if (!item) return res.json({ sent: 0, remaining: 0 });

  const camp = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(campaign_id);
  if (!camp) return res.status(400).json({ error: "Campaign not found" });

  const sender = db.prepare("SELECT * FROM senders WHERE id = ?").get(camp.sender_id);
  if (!sender) return res.status(400).json({ error: "Sender not found" });

  const rid = hashEmail(item.email_to);
  const pixel = '<img src="https://vendirect.lu/api/track/open?id='+rid+'&campaign='+campaign_id+'" width="1" height="1" alt="" />';

  try {
    const transporter = nodemailer.createTransport({
      host: sender.smtp, port: sender.port, secure: true,
      auth: { user: sender.usr, pass: sender.pass },
      tls: { rejectUnauthorized: false },
    });
    await transporter.sendMail({
      from: '"'+sender.sender_name+'" <'+sender.usr+'>',
      to: item.email_to, subject: item.subject, html: item.body + pixel,
    });
    db.prepare("UPDATE queue SET status = 'sent' WHERE id = ?").run(item.id);
    db.prepare("UPDATE stats SET sent = sent + 1 WHERE campaign_id = ?").run(campaign_id);

    const remaining = db.prepare("SELECT COUNT(*) as c FROM queue WHERE campaign_id = ? AND status = 'pending'").get(campaign_id).c;
    return res.json({ sent: 1, remaining });
  } catch (e) {
    db.prepare("UPDATE queue SET status = 'error' WHERE id = ?").run(item.id);
    return res.json({ sent: 0, error: e.message, remaining: db.prepare("SELECT COUNT(*) as c FROM queue WHERE campaign_id = ? AND status = 'pending'").get(campaign_id).c });
  }
});

// Stats
app.get("/api/stats", (req, res) => {
  const totals = db.prepare("SELECT COALESCE(SUM(sent),0) as sent, COALESCE(SUM(opens),0) as opens, COALESCE(SUM(clicks),0) as clicks FROM stats").get();
  res.json(totals);
});

// Settings
app.get("/api/settings", (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("config");
  res.json(row ? JSON.parse(row.value) : { delay: 80, startTime: "08:00", endTime: "22:00" });
});
app.post("/api/settings", (req, res) => {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('config', ?)").run(JSON.stringify(req.body));
  res.json({ ok: true });
});
db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)");

// Serve index.html for SPA routing
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n✅ MSCC Send lancé sur http://localhost:${PORT}\n`);
  const { exec } = require("child_process");
  exec(`open http://localhost:${PORT}`);
});
