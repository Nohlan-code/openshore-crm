const express = require("express");
const crypto  = require("crypto");
const cors    = require("cors");

const app = express();
app.use(express.json());
app.use(cors()); // permet au CRM (front-end) d'appeler ce serveur

// ─── Stockage en mémoire (remplacé par une vraie DB si besoin) ────────────────
// Pour Railway : les données persistent tant que le serveur tourne.
// Pour une vraie persistance, connectez une DB Postgres via Railway.
const orders = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid() {
  return crypto.randomUUID();
}

function deadline7() {
  return new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
}

/**
 * Récupère la valeur d'une réponse Typeform à partir du ref du champ.
 * Les "ref" sont définis dans Typeform → Builder → chaque question a un ref.
 */
function getAnswer(answers, fields, ref) {
  const fieldIdx = fields.findIndex(f => f.ref === ref);
  if (fieldIdx === -1) return "";
  const ans = answers.find(a => a.field && a.field.ref === ref);
  if (!ans) return "";

  switch (ans.type) {
    case "text":
    case "long_text":
    case "short_text":
      return ans.text || "";
    case "url":
      return ans.url || "";
    case "email":
      return ans.email || "";
    case "phone_number":
      return ans.phone_number || "";
    case "choice":
      return ans.choice?.label || "";
    case "choices":
      return ans.choices?.labels?.join(", ") || "";
    case "date":
      return ans.date || "";
    default:
      return JSON.stringify(ans);
  }
}

// ─── Webhook Typeform ─────────────────────────────────────────────────────────
// URL à coller dans Typeform → Connect → Webhooks :
// https://VOTRE-APP.railway.app/webhook/typeform
app.post("/webhook/typeform", (req, res) => {
  try {
    const { form_response } = req.body;
    if (!form_response) return res.sendStatus(400);

    const answers = form_response.answers || [];
    const fields  = form_response.definition?.fields || [];

    // ──────────────────────────────────────────────────────────────────────────
    // MAPPING DES CHAMPS — Formulaire Openshore (rJdfntNq)
    //
    // Pour trouver les vrais refs de vos champs :
    // 1. Allez sur https://api.typeform.com/forms/rJdfntNq
    //    (avec votre Personal Token dans le header Authorization)
    // 2. Cherchez "ref" dans chaque objet "field"
    // 3. Remplacez les valeurs ci-dessous par vos vrais refs
    //
    // En attendant, ce code tente de parser par position (order) comme fallback.
    // ──────────────────────────────────────────────────────────────────────────

    // Fallback : récupérer par index si les refs ne correspondent pas encore
    function getByIndex(idx) {
      const ans = answers[idx];
      if (!ans) return "";
      if (ans.text)         return ans.text;
      if (ans.email)        return ans.email;
      if (ans.phone_number) return ans.phone_number;
      if (ans.url)          return ans.url;
      if (ans.choice)       return ans.choice.label;
      if (ans.choices)      return ans.choices.labels.join(", ");
      return "";
    }

    // Champ 2 : "Présentez vous Prénom, nom, numéro de téléphone email entreprise"
    // C'est souvent un champ texte libre — on essaie de l'identifier
    const identity    = getAnswer(answers, fields, "client_identity") || getByIndex(1);
    const lines       = identity.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);

    const order = {
      id:                 uid(),
      createdAt:          new Date().toISOString(),
      source:             "typeform",
      typeformResponseId: form_response.token,
      status:             "new",
      freelanceId:        null,
      deadline:           deadline7(),
      projectType:        "Landing page",

      // Champ 1 — "Décrivez nous votre landing page de rêve"
      description:        getAnswer(answers, fields, "landing_dream")        || getByIndex(0),

      // Champ 2 — "Présentez vous Prénom, nom, numéro de téléphone email entreprise"
      clientName:         getAnswer(answers, fields, "client_name")          || lines[0] || identity,
      clientPhone:        getAnswer(answers, fields, "client_phone")         || lines[2] || "",
      clientEmail:        getAnswer(answers, fields, "client_email")         || lines[3] || "",
      company:            getAnswer(answers, fields, "client_company")       || lines[4] || "",

      // Champ 3 — "Objectif de la landing page"
      landingObjective:   getAnswer(answers, fields, "landing_objective")    || getByIndex(2),

      // Champ 4 — "Décrivez vos offres"
      offers:             getAnswer(answers, fields, "offers_description")   || getByIndex(3),

      // Champ 5 — "Ajoutez vos documents (logos, photos…)"
      assets:             getAnswer(answers, fields, "assets_link")          || getByIndex(4),

      // Champ 6 — "Choisissez 3 couleurs"
      colors:             getAnswer(answers, fields, "brand_colors")         || getByIndex(5),

      // Champ 7 — "Une inspiration web ?"
      inspiration:        getAnswer(answers, fields, "inspiration_url")      || getByIndex(6),
    };

    orders.unshift(order); // ajoute en tête de liste
    console.log(`✅ Nouvelle commande reçue : ${order.clientName} (${order.id})`);
    res.sendStatus(200);

  } catch (err) {
    console.error("❌ Erreur webhook :", err);
    res.sendStatus(500);
  }
});

// ─── API — récupérer les nouvelles commandes (appelée par le CRM) ─────────────
// Le CRM envoie un GET /orders?since=ISO_DATE pour ne récupérer que les nouvelles
app.get("/orders", (req, res) => {
  const since = req.query.since ? new Date(req.query.since) : null;
  const result = since
    ? orders.filter(o => new Date(o.createdAt) > since)
    : orders;
  res.json(result);
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status:  "✅ Openshore Webhook Server running",
    orders:  orders.length,
    uptime:  Math.floor(process.uptime()) + "s",
  });
});

// ─── Démarrage ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Openshore Webhook Server démarré sur le port ${PORT}`);
});
