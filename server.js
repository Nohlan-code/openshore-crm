const express  = require("express");
const crypto   = require("crypto");
const cors     = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(express.json());
app.use(cors());

// ─── PostgreSQL ───────────────────────────────────────────────────────────────
// Railway injecte DATABASE_URL automatiquement quand vous liez la DB
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id                   TEXT PRIMARY KEY,
      created_at           TIMESTAMPTZ DEFAULT NOW(),
      source               TEXT,
      typeform_response_id TEXT UNIQUE,
      status               TEXT DEFAULT 'new',
      freelance_id         TEXT,
      deadline             TEXT,
      project_type         TEXT,
      client_name          TEXT,
      client_email         TEXT,
      client_phone         TEXT,
      company              TEXT,
      description          TEXT,
      landing_objective    TEXT,
      offers               TEXT,
      assets               TEXT,
      colors               TEXT,
      inspiration          TEXT
    )
  `);
  console.log("✅ Table orders prête");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function deadline7() {
  return new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
}

function getAnswer(answers, ref) {
  const ans = answers.find(a => a.field && a.field.ref === ref);
  if (!ans) return "";
  return ans.text || ans.email || ans.phone_number || ans.url
    || ans.choice?.label || ans.choices?.labels?.join(", ") || "";
}

function getByIndex(answers, idx) {
  const ans = answers[idx];
  if (!ans) return "";
  return ans.text || ans.email || ans.phone_number || ans.url
    || ans.choice?.label || ans.choices?.labels?.join(", ") || "";
}

// ─── POST /webhook/typeform ───────────────────────────────────────────────────
app.post("/webhook/typeform", async (req, res) => {
  try {
    const { form_response } = req.body;
    if (!form_response) return res.sendStatus(400);

    const answers = form_response.answers || [];

    // Champ 2 : identité client (texte libre multi-ligne)
    const identity = getAnswer(answers, "client_identity") || getByIndex(answers, 1);
    const lines    = identity.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);

    const id = crypto.randomUUID();

    await pool.query(`
      INSERT INTO orders (
        id, source, typeform_response_id, status, freelance_id, deadline, project_type,
        client_name, client_email, client_phone, company, description,
        landing_objective, offers, assets, colors, inspiration
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (typeform_response_id) DO NOTHING
    `, [
      id,
      "typeform",
      form_response.token,
      "new",
      null,
      deadline7(),
      "Landing page",
      getAnswer(answers,"client_name")       || lines[0] || identity,
      getAnswer(answers,"client_email")      || lines[3] || "",
      getAnswer(answers,"client_phone")      || lines[2] || "",
      getAnswer(answers,"client_company")    || lines[4] || "",
      getAnswer(answers,"landing_dream")     || getByIndex(answers,0),
      getAnswer(answers,"landing_objective") || getByIndex(answers,2),
      getAnswer(answers,"offers_description")|| getByIndex(answers,3),
      getAnswer(answers,"assets_link")       || getByIndex(answers,4),
      getAnswer(answers,"brand_colors")      || getByIndex(answers,5),
      getAnswer(answers,"inspiration_url")   || getByIndex(answers,6),
    ]);

    console.log(`✅ Commande reçue depuis Typeform (token: ${form_response.token})`);
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erreur webhook :", err.message);
    res.sendStatus(500);
  }
});

// ─── GET /orders ──────────────────────────────────────────────────────────────
app.get("/orders", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM orders ORDER BY created_at DESC");
    res.json(rows.map(r => ({
      id:                 r.id,
      createdAt:          r.created_at,
      source:             r.source,
      typeformResponseId: r.typeform_response_id,
      status:             r.status,
      freelanceId:        r.freelance_id,
      deadline:           r.deadline,
      projectType:        r.project_type,
      clientName:         r.client_name,
      clientEmail:        r.client_email,
      clientPhone:        r.client_phone,
      company:            r.company,
      description:        r.description,
      landingObjective:   r.landing_objective,
      offers:             r.offers,
      assets:             r.assets,
      colors:             r.colors,
      inspiration:        r.inspiration,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET / — health check ─────────────────────────────────────────────────────
app.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT COUNT(*) FROM orders");
    res.json({
      status: "✅ Openshore Webhook Server running",
      db:     "✅ PostgreSQL connecté",
      orders: parseInt(rows[0].count),
      uptime: Math.floor(process.uptime()) + "s",
    });
  } catch (err) {
    res.json({ status: "✅ Server running", db: "❌ DB non connectée", error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
initDB()
  .then(() => app.listen(PORT, () => console.log(`🚀 Port ${PORT}`)))
  .catch(err => { console.error("❌ DB init failed:", err); process.exit(1); });

