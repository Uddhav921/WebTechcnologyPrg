require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { createSheetStore } = require("./sheet-store");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1"; // local only: this app has no login of its own
const { SHEETS_WEB_APP_URL, SHEETS_SECRET, GOOGLE_SHEET_ID } = process.env;
const configured = !!(SHEETS_WEB_APP_URL && SHEETS_SECRET);
const store = configured ? createSheetStore({ url: SHEETS_WEB_APP_URL, secret: SHEETS_SECRET }) : null;
const sheetId = (String(GOOGLE_SHEET_ID || "").match(/\/d\/([a-zA-Z0-9_-]+)/) || [, String(GOOGLE_SHEET_ID || "").trim()])[1];

app.disable("x-powered-by");
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));


/* ---------- Google sign-in (optional login for the dashboard) ---------- */
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ALLOWED_EMAILS, SESSION_SECRET } = process.env;
const authEnabled = !!GOOGLE_CLIENT_ID;
const allowed = String(ALLOWED_EMAILS || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
if (authEnabled && (!GOOGLE_CLIENT_SECRET || !allowed.length)) {
  console.error("Google sign-in needs GOOGLE_CLIENT_SECRET and ALLOWED_EMAILS in .env (see README.md).");
  process.exit(1);
}
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
const AUTH_URL = process.env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const SESSION_DAYS = 7;
const key = SESSION_SECRET || crypto.randomBytes(32).toString("hex"); // without SESSION_SECRET, sign-ins end when the server restarts
const sign = p => crypto.createHmac("sha256", key).update(p).digest("base64url");
const makeToken = o => { const p = Buffer.from(JSON.stringify(o)).toString("base64url"); return `${p}.${sign(p)}`; };
function readToken(t) {
  const [p, sig] = String(t || "").split(".");
  if (!p || !sig) return null;
  const ok = sign(p);
  if (sig.length !== ok.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(ok))) return null;
  try { const o = JSON.parse(Buffer.from(p, "base64url").toString()); return o.exp > Date.now() ? o : null; } catch { return null; }
}
const cookies = req => Object.fromEntries((req.headers.cookie || "").split(";").map(c => c.trim()).filter(Boolean).map(c => { const i = c.indexOf("="); return [c.slice(0, i), c.slice(i + 1)]; }));
const setCookie = (res, name, val, maxAge) => res.append("Set-Cookie", `${name}=${val}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
const getSession = req => (authEnabled ? readToken(cookies(req).fin_session) : null);
const fail = (res, msg) => res.redirect("/?auth_error=" + encodeURIComponent(msg));

app.get("/auth/login", (req, res) => {
  if (!authEnabled) return res.redirect("/");
  const state = crypto.randomBytes(16).toString("hex"), nonce = crypto.randomBytes(16).toString("hex");
  setCookie(res, "fin_oauth", makeToken({ s: state, n: nonce, exp: Date.now() + 10 * 60 * 1000 }), 600);
  const q = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: "code", scope: "openid email profile", state, nonce, prompt: "select_account" });
  res.redirect(`${AUTH_URL}?${q}`);
});

app.get("/auth/callback", async (req, res) => {
  if (!authEnabled) return res.redirect("/");
  try {
    if (req.query.error) return fail(res, "Google sign-in was cancelled.");
    const pending = readToken(cookies(req).fin_oauth);
    if (!pending || pending.s !== req.query.state || !req.query.code) return fail(res, "Sign-in expired. Please try again.");
    const r = await fetch(TOKEN_URL, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: String(req.query.code), client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: "authorization_code" })
    });
    const tok = await r.json();
    if (!r.ok || !tok.id_token) return fail(res, "Google sign-in failed. Check your Client ID, secret and redirect URI.");
    // The ID token arrives straight from Google's token endpoint over HTTPS; we still check its claims.
    const c = JSON.parse(Buffer.from(tok.id_token.split(".")[1], "base64url").toString());
    const email = String(c.email || "").toLowerCase();
    if (c.aud !== GOOGLE_CLIENT_ID || !["https://accounts.google.com", "accounts.google.com"].includes(c.iss) || c.exp * 1000 < Date.now() || c.nonce !== pending.n)
      return fail(res, "Sign-in could not be verified. Please try again.");
    if (!c.email_verified || !allowed.includes(email)) return fail(res, `${email || "This account"} is not allowed to use this app.`);
    setCookie(res, "fin_session", makeToken({ e: email, n: c.name || "", p: c.picture || "", exp: Date.now() + SESSION_DAYS * 86400000 }), SESSION_DAYS * 86400);
    setCookie(res, "fin_oauth", "", 0);
    res.redirect("/");
  } catch (e) { console.error("OAuth callback failed:", e.message); fail(res, "Google sign-in failed. Please try again."); }
});

app.post("/auth/logout", (req, res) => { setCookie(res, "fin_session", "", 0); res.json({ success: true }); });

app.get("/status", (req, res) => {
  const sess = getSession(req), signedIn = !authEnabled || !!sess;
  res.json({
    configured, mode: "sheets", authEnabled, signedIn,
    user: sess ? { email: sess.e, name: sess.n, picture: sess.p } : null,
    sheetUrl: signedIn && sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit` : null
  });
});
app.use("/api", (req, res, next) =>
  authEnabled && !getSession(req) ? res.status(401).json({ code: "AUTH", error: "Please sign in with Google." }) : next());

app.use("/api", (req, res, next) =>
  configured ? next() : res.status(503).json({ code: "SETUP", error: "Your Google Sheet isn't connected yet." }));

const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error(e.message);
  res.status(e.status || 502).json({ error: e.message || "Google Sheet error. Please try again." });
});

function validateTransaction(body) {
  const { title, amount, type, category, date } = body;
  const n = Number(amount);
  if (!String(title || "").trim()) return "Title is required.";
  if (!Number.isFinite(n) || n <= 0) return "Amount must be greater than zero.";
  if (!["income", "expense"].includes(type)) return "Type must be income or expense.";
  if (!String(category || "").trim()) return "Category is required.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) || Number.isNaN(Date.parse(date))) return "A valid date is required.";
  return null;
}
const clean = b => ({
  title: String(b.title).trim().slice(0, 100), amount: Math.round(Number(b.amount) * 100) / 100, type: b.type,
  category: String(b.category).trim().slice(0, 40), date: b.date, note: String(b.note || "").trim().slice(0, 300)
});
const byNewest = (a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt;

app.get("/api/transactions", wrap(async (req, res) => {
  const { type, category, search, month } = req.query;
  let items = await store.list();
  if (["income", "expense"].includes(type)) items = items.filter(x => x.type === type);
  if (category) items = items.filter(x => x.category.toLowerCase() === String(category).toLowerCase());
  if (search) {
    const t = String(search).toLowerCase();
    items = items.filter(x => x.title.toLowerCase().includes(t) || x.category.toLowerCase().includes(t) || (x.note || "").toLowerCase().includes(t));
  }
  if (month && /^\d{4}-\d{2}$/.test(month)) items = items.filter(x => x.date.slice(0, 7) === month);
  res.json([...items].sort(byNewest));
}));

app.get("/api/summary", wrap(async (req, res) => {
  const items = await store.list(), sum = (a, t) => a.filter(x => x.type === t).reduce((s, x) => s + x.amount, 0);
  const now = new Date(), month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const mi = items.filter(x => x.date.slice(0, 7) === month);
  const income = sum(items, "income"), expenses = sum(items, "expense");
  res.json({ income, expenses, balance: income - expenses, monthlyIncome: sum(mi, "income"), monthlyExpenses: sum(mi, "expense"), count: items.length });
}));

app.post("/api/transactions", wrap(async (req, res) => {
  const error = validateTransaction(req.body);
  if (error) return res.status(400).json({ error });
  res.status(201).json(await store.add({ id: crypto.randomUUID(), ...clean(req.body), createdAt: Date.now() }));
}));

app.put("/api/transactions/:id", wrap(async (req, res) => {
  const error = validateTransaction(req.body);
  if (error) return res.status(400).json({ error });
  const updated = await store.update(req.params.id, clean(req.body));
  if (!updated) return res.status(404).json({ error: "Transaction not found. It may have been removed from the sheet." });
  res.json(updated);
}));

app.delete("/api/transactions/:id", wrap(async (req, res) => {
  if (!(await store.remove(req.params.id))) return res.status(404).json({ error: "Transaction not found. It may have been removed from the sheet." });
  res.json({ success: true });
}));

app.get("/api/export", wrap(async (req, res) => {
  const items = [...(await store.list())].sort(byNewest);
  const esc = v => { let s = String(v ?? ""); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const rows = items.map(x => [x.date, x.title, x.type, x.category, x.amount.toFixed(2), x.note].map(esc).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="finance-transactions.csv"');
  res.send(["Date,Title,Type,Category,Amount,Note", ...rows].join("\r\n"));
}));

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, HOST, () => {
  console.log(`Finance Controller running at http://localhost:${PORT}`);
  console.log(configured ? "Storage: Google Sheet" : "Google Sheet not connected yet — see README.md");
});
