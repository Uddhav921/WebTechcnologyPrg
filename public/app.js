const $ = id => document.getElementById(id);
const currency = v => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(v);
const compact = v => {
  const f = (n, u) => `${+n.toFixed(1)}${u}`;
  return v >= 1e7 ? f(v / 1e7, "Cr") : v >= 1e5 ? f(v / 1e5, "L") : v >= 1e3 ? f(v / 1e3, "K") : String(Math.round(v));
};
let toastTimer, all = [], typeFilter = "";

const CATS = {
  Food: ["🍜", "#f59e0b"], Transport: ["🚌", "#3b82f6"], Shopping: ["🛍️", "#ec4899"], Bills: ["🧾", "#ef4444"],
  Education: ["🎓", "#8b5cf6"], Health: ["💊", "#14b8a6"], Salary: ["💼", "#10b981"], Freelance: ["💻", "#06b6d4"],
  Investment: ["📈", "#84cc16"], Other: ["✨", "#94a3b8"]
};
Object.assign(CATS, { Groceries: ["🛒", "#22c55e"], Rent: ["🏠", "#f97316"], Entertainment: ["🎬", "#a855f7"], Travel: ["✈️", "#0ea5e9"], Gift: ["🎁", "#f43f5e"] });
const EXPENSE_CATS = ["Education", "Food", "Groceries", "Transport", "Shopping", "Bills", "Rent", "Health", "Entertainment", "Travel", "Other"];
const INCOME_CATS = ["Salary", "Freelance", "Investment", "Gift", "Other"];
const hue = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const cat = name => CATS[name] || ["🏷️", `hsl(${hue(String(name))} 62% 50%)`];
const SUGGEST = [
  [/fee|tuition|school|college|course|exam|books?/i, "Education"], [/grocer|vegetable|supermarket|kirana/i, "Groceries"],
  [/uber|ola|petrol|diesel|fuel|metro|bus|auto|cab|train/i, "Transport"], [/rent|maintenance/i, "Rent"],
  [/electric|water bill|wifi|internet|recharge|emi|insurance|bill/i, "Bills"], [/doctor|medicine|pharmacy|hospital|clinic|dental/i, "Health"],
  [/swiggy|zomato|restaurant|lunch|dinner|breakfast|cafe|food|snack/i, "Food"], [/movie|netflix|prime|game|concert/i, "Entertainment"],
  [/flight|hotel|trip|ticket/i, "Travel"], [/amazon|flipkart|myntra|shopping|clothes/i, "Shopping"]
];
const SUGGEST_INCOME = [[/salary|payroll/i, "Salary"], [/freelance|client|project/i, "Freelance"], [/dividend|interest|stock|mutual/i, "Investment"], [/gift/i, "Gift"]];
let catTouched = false;

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data?.error || "Something went wrong. Please try again.");
    err.code = data?.code;
    if (err.code === "AUTH") { auth.signedIn = false; showLogin(); }
    if (err.code === "SETUP") { auth.connected = false; showGate(data?.error || ""); }
    throw err;
  }
  return data;
}
function showToast(message) {
  $("toast").textContent = message; $("toast").classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2800);
}
const safeText = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const displayDate = v => {
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
const sum = (items, type) => items.filter(x => x.type === type).reduce((s, x) => s + x.amount, 0);
const localMonth = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/* ---------- Charts ---------- */
function renderFlow() {
  const months = [], now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = localMonth(d), items = all.filter(x => x.date.slice(0, 7) === key);
    months.push({ label: d.toLocaleDateString("en-IN", { month: "short" }), inc: sum(items, "income"), exp: sum(items, "expense") });
  }
  const max = Math.max(1, ...months.flatMap(m => [m.inc, m.exp]));
  if (!all.length) { $("flowChart").innerHTML = '<div class="chart-empty">Add transactions to see your monthly cash flow.</div>'; return; }
  const W = 560, H = 220, pad = { t: 10, b: 28, l: 40, r: 6 }, ch = H - pad.t - pad.b, step = (W - pad.l - pad.r) / months.length, bw = Math.min(20, step / 3);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Income and expenses per month">`;
  for (let i = 0; i <= 3; i++) {
    const y = pad.t + ch - (ch * i) / 3;
    svg += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/><text x="${pad.l - 8}" y="${y + 4}" text-anchor="end">${compact((max * i) / 3)}</text>`;
  }
  months.forEach((m, i) => {
    const cx = pad.l + step * i + step / 2, hi = (m.inc / max) * ch, he = (m.exp / max) * ch;
    svg += `<g class="col"><title>${m.label}: ${currency(m.inc)} in, ${currency(m.exp)} out</title>
      <rect class="b" x="${cx - bw - 2}" y="${pad.t + ch - hi}" width="${bw}" height="${Math.max(hi, m.inc ? 3 : 0)}" rx="5" fill="var(--inc)"/>
      <rect class="b" x="${cx + 2}" y="${pad.t + ch - he}" width="${bw}" height="${Math.max(he, m.exp ? 3 : 0)}" rx="5" fill="var(--exp)"/>
      <text x="${cx}" y="${H - 8}" text-anchor="middle">${m.label}</text></g>`;
  });
  $("flowChart").innerHTML = svg + "</svg>";
}

function renderDonut() {
  const month = localMonth(), monthExp = all.filter(x => x.type === "expense" && x.date.slice(0, 7) === month);
  const useMonth = monthExp.length > 0, exp = useMonth ? monthExp : all.filter(x => x.type === "expense");
  $("donutCaption").textContent = useMonth ? "This month" : "All time";
  const totals = {}; exp.forEach(x => totals[x.category] = (totals[x.category] || 0) + x.amount);
  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]), total = rows.reduce((s, r) => s + r[1], 0);
  if (!total) { $("donutChart").innerHTML = ""; $("donutLegend").innerHTML = '<div class="chart-empty">No expenses yet.</div>'; return; }
  const R = 54, C = 2 * Math.PI * R; let off = 0;
  let svg = `<svg viewBox="0 0 140 140"><circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--line)" stroke-width="16"/>`;
  rows.forEach(([name, v]) => {
    const len = (v / total) * C;
    svg += `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${cat(name)[1]}" stroke-width="16" stroke-dasharray="${Math.max(len - 2, 0.5)} ${C}" stroke-dashoffset="${-off}"><title>${safeText(name)}: ${currency(v)}</title></circle>`;
    off += len;
  });
  $("donutChart").innerHTML = svg + `</svg><div class="center"><small>Spent</small><b>${compact(total)}</b></div>`;
  $("donutLegend").innerHTML = rows.slice(0, 5).map(([n, v]) =>
    `<li><i style="background:${cat(n)[1]}"></i><span>${safeText(n)}</span><em>${Math.round((v / total) * 100)}%</em></li>`).join("");
}

/* ---------- Table ---------- */
function filtered() {
  const q = $("searchInput").value.trim().toLowerCase(), m = $("monthFilter").value;
  return all.filter(x =>
    (!typeFilter || x.type === typeFilter) && (!m || x.date.slice(0, 7) === m) &&
    (!q || x.title.toLowerCase().includes(q) || x.category.toLowerCase().includes(q) || (x.note || "").toLowerCase().includes(q)));
}

const editIcon = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>';
const delIcon = '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

function renderTable() {
  const rows = $("transactionRows"), items = filtered();
  $("transactionCount").textContent = `${items.length} transaction${items.length === 1 ? "" : "s"}`;
  if (!items.length) {
    const none = !all.length;
    rows.innerHTML = `<tr class="static"><td colspan="5"><div class="empty-state"><div class="big">${none ? "🌱" : "🔍"}</div><strong>${none ? "Start tracking your money" : "No transactions found"}</strong><span>${none ? "Add your first income or expense to see your balance and charts." : "Try changing your search or filters."}</span>${none ? '<button class="button primary" id="emptyAdd">Add transaction</button>' : ""}</div></td></tr>`;
    return;
  }
  rows.innerHTML = items.map(item => {
    const [icon, color] = cat(item.category), inc = item.type === "income";
    return `<tr>
      <td><div class="tx"><div class="tx-ico" style="background:${color}22">${icon}</div><div><div class="transaction-title">${safeText(item.title)}</div>${item.note ? `<div class="transaction-note">${safeText(item.note)}</div>` : ""}</div></div></td>
      <td><span class="category-pill" style="background:${color}1f;color:${color}">${safeText(item.category)}</span></td>
      <td class="date-cell">${safeText(displayDate(item.date))}</td>
      <td class="amount ${inc ? "positive" : "negative"}">${inc ? "+" : "−"}${safeText(currency(item.amount))}</td>
      <td><div class="row-actions"><button class="icon-button" data-edit="${safeText(item.id)}" aria-label="Edit ${safeText(item.title)}" title="Edit">${editIcon}</button><button class="icon-button delete" data-delete="${safeText(item.id)}" aria-label="Delete ${safeText(item.title)}" title="Delete">${delIcon}</button></div></td>
    </tr>`;
  }).join("");
}

/* ---------- Sync with storage (Google Sheets) ---------- */
let auth = { configured: false, connected: true, mode: "sheets" }, lastSig = "", busy = 0;
const hhmm = () => new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
function setSync(state, text) {
  const pill = $("syncPill");
  pill.dataset.state = state; $("syncText").textContent = text;
  if (auth.sheetUrl && auth.connected) { pill.href = auth.sheetUrl; pill.title = "Open your Google Sheet"; } else { pill.removeAttribute("href"); pill.href = "#"; }
}
const where = () => auth.mode === "sheets" ? "Google Sheets" : auth.mode === "browser" ? "this browser" : "this computer";
function showGate(message = "") {
  $("gate").classList.remove("hidden"); $("gateError").textContent = message;
  setSync("idle", "Not connected");
}
function showLogin(message = "") {
  $("loginGate").classList.remove("hidden"); $("loginError").textContent = message;
  setSync("idle", "Signed out");
}
async function tracked(label, fn) {   // run a write while showing "Saving…" status
  busy++; setSync("syncing", label);
  try { return await fn(); }
  catch (e) { if ((e.code !== "SETUP" && e.code !== "AUTH")) setSync("error", "Sync failed"); throw e; }
  finally { busy--; }
}
async function refresh({ silent = false } = {}) {
  if (!silent) setSync("syncing", "Syncing…");
  try {
    const [, items] = await Promise.all([loadSummary(), api("/api/transactions")]);
    const sig = JSON.stringify(items);
    if (!(silent && sig === lastSig)) { lastSig = sig; all = items; renderTable(); renderFlow(); renderDonut(); }
    setSync("ok", auth.mode === "sheets" ? `Synced ${hhmm()}` : (auth.mode === "browser" ? "Saved in this browser" : "Saved locally"));
  } catch (e) { if ((e.code !== "SETUP" && e.code !== "AUTH")) setSync("error", "Sync failed"); throw e; }
}
async function loadSummary() {
  const s = await api("/api/summary");
  $("balance").textContent = currency(s.balance);
  $("income").textContent = currency(s.income);
  $("expenses").textContent = currency(s.expenses);
  const net = s.monthlyIncome - s.monthlyExpenses;
  $("monthlyNet").textContent = (net > 0 ? "+" : net < 0 ? "−" : "") + currency(Math.abs(net));
  $("monthlyNet").style.color = net < 0 ? "var(--exp)" : net > 0 ? "var(--inc)" : "var(--ink)";
  $("monthlyCaption").textContent = `${currency(s.monthlyIncome)} in · ${currency(s.monthlyExpenses)} out`;
}
// pick up edits made directly in the sheet (and from other devices)
setInterval(() => {
  if (document.hidden || !auth.connected || auth.signedIn === false || busy || !$("modalBackdrop").classList.contains("hidden")) return;
  refresh({ silent: true }).catch(() => {});
}, 15000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && auth.connected && !busy) refresh({ silent: true }).catch(() => {}); });
$("gateRetry").addEventListener("click", () => location.reload());
$("signOutBtn").addEventListener("click", async () => {
  try { await api("/auth/logout", { method: "POST" }); } catch {}
  location.reload();
});

/* ---------- Modal ---------- */
function populateCats(selected = "") {
  const base = $("type").value === "income" ? INCOME_CATS : EXPENSE_CATS;
  const extras = [...new Set(all.filter(x => x.type === $("type").value).map(x => x.category))].filter(c => !base.includes(c));
  const list = [...base.filter(c => c !== "Other"), ...extras, "Other"];
  if (selected && !list.includes(selected)) list.splice(list.length - 1, 0, selected);
  $("category").innerHTML = '<option value="" disabled>Select a category</option>' +
    list.map(c => `<option value="${safeText(c)}">${safeText(cat(c)[0])}  ${safeText(c)}</option>`).join("") + '<option value="__new">＋ New category…</option>';
  $("category").value = list.includes(selected) ? selected : "";
  $("customWrap").classList.add("hidden");
}
function setType(t) {
  const prev = $("category").value;
  $("type").value = t;
  document.querySelectorAll("#typeSwitch button").forEach(b => b.classList.toggle("active", b.dataset.type === t));
  populateCats(prev && prev !== "__new" ? prev : "");
}
function openModal(item = null) {
  $("transactionForm").reset(); $("formError").textContent = "";
  $("transactionId").value = item?.id || "";
  $("modalTitle").textContent = item ? "Edit transaction" : "Add transaction";
  $("saveButton").textContent = item ? "Update transaction" : "Save transaction";
  catTouched = !!item;
  $("category").innerHTML = "";
  setType(item?.type || "expense");
  populateCats(item?.category || "");
  $("title").value = item?.title || ""; $("amount").value = item?.amount ?? "";
  $("date").value = item?.date || new Date().toLocaleDateString("en-CA");
  $("note").value = item?.note || "";
  $("modalBackdrop").classList.remove("hidden"); $("title").focus();
}
const closeModal = () => $("modalBackdrop").classList.add("hidden");
const formData = () => ({ title: $("title").value.trim(), amount: Number($("amount").value), type: $("type").value, category: $("category").value === "__new" ? $("customCategory").value.trim() : $("category").value, date: $("date").value, note: $("note").value.trim() });

$("addTopButton").addEventListener("click", () => openModal());
$("fabButton").addEventListener("click", () => openModal());
$("closeModal").addEventListener("click", closeModal);
$("cancelModal").addEventListener("click", closeModal);
$("modalBackdrop").addEventListener("click", e => { if (e.target === $("modalBackdrop")) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
$("category").addEventListener("change", () => {
  catTouched = true;
  const isNew = $("category").value === "__new";
  $("customWrap").classList.toggle("hidden", !isNew);
  if (isNew) $("customCategory").focus();
});
$("title").addEventListener("input", () => {
  if (catTouched || $("transactionId").value) return;
  const rules = $("type").value === "income" ? SUGGEST_INCOME : SUGGEST;
  const hit = rules.find(([re]) => re.test($("title").value));
  if (hit && [...$("category").options].some(o => o.value === hit[1])) $("category").value = hit[1];
});
$("typeSwitch").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setType(b.dataset.type); });

$("transactionForm").addEventListener("submit", async e => {
  e.preventDefault(); $("formError").textContent = "";
  const id = $("transactionId").value;
  const chosen = $("category").value;
  if (!chosen || (chosen === "__new" && !$("customCategory").value.trim())) { $("formError").textContent = "Please choose a category."; return; }
  try {
    $("saveButton").disabled = true;
    await tracked(auth.mode === "sheets" ? "Saving to Sheets…" : "Saving…", () =>
      api(id ? `/api/transactions/${encodeURIComponent(id)}` : "/api/transactions", { method: id ? "PUT" : "POST", body: JSON.stringify(formData()) }));
    closeModal(); await refresh();
    showToast(id ? "Transaction updated." : "Transaction added.");
  } catch (err) { $("formError").textContent = err.message; }
  finally { $("saveButton").disabled = false; }
});

$("transactionRows").addEventListener("click", async e => {
  const edit = e.target.closest("[data-edit]"), del = e.target.closest("[data-delete]");
  if (edit) { const item = all.find(x => x.id === edit.dataset.edit); if (item) openModal(item); }
  if (del) {
    if (!confirm("Delete this transaction? This cannot be undone.")) return;
    const btn = del;
    btn.disabled = true;
    try {
      await tracked("Deleting…", () => api(`/api/transactions/${encodeURIComponent(del.dataset.delete)}`, { method: "DELETE" }));
      await refresh();
      showToast("Transaction deleted.");
    } catch (err) {
      showToast("❌ Delete failed: " + err.message);
    } finally {
      btn.disabled = false;
    }
  }
  if (e.target.closest("#emptyAdd")) openModal();
});

/* ---------- Filters ---------- */
let searchTimer;
$("searchInput").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderTable, 150); });
$("monthFilter").addEventListener("change", renderTable);
$("typeSeg").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  typeFilter = b.dataset.type;
  document.querySelectorAll("#typeSeg button").forEach(x => x.classList.toggle("active", x === b)); renderTable();
});
$("clearFilters").addEventListener("click", () => {
  $("searchInput").value = ""; $("monthFilter").value = ""; typeFilter = "";
  document.querySelectorAll("#typeSeg button").forEach((x, i) => x.classList.toggle("active", i === 0)); renderTable();
});

/* ---------- Export CSV ---------- */
$("exportCsvBtn").addEventListener("click", async () => {
  const btn = $("exportCsvBtn");
  const originalText = btn.querySelector("span").textContent;
  btn.disabled = true;
  btn.querySelector("span").textContent = "Exporting…";
  try {
    const res = await fetch("/api/export", { headers: { "Accept": "text/csv" } });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { showToast("Please sign in first."); return; }
      showToast("Export failed: " + (data.error || res.statusText));
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finance-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("CSV downloaded!");
  } catch (e) {
    showToast("Export failed: " + e.message);
  } finally {
    btn.disabled = false;
    btn.querySelector("span").textContent = originalText;
  }
});

/* ---------- Theme, nav, greeting ---------- */
const isDark = () => document.documentElement.dataset.theme === "dark";
function syncThemeLabel() { $("themeLabel").textContent = isDark() ? "Light mode" : "Dark mode"; }
const toggleTheme = () => {
  const next = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch {}
  syncThemeLabel();
};
$("themeToggle").addEventListener("click", toggleTheme);
$("themeTop").addEventListener("click", toggleTheme);
syncThemeLabel();

const navLinks = document.querySelectorAll("[data-nav]");
new IntersectionObserver(entries => {
  entries.forEach(en => { if (en.isIntersecting) navLinks.forEach(a => a.classList.toggle("active", a.dataset.nav === en.target.id)); });
}, { rootMargin: "-40% 0px -50% 0px" }).observe($("transactions"));
window.addEventListener("scroll", () => { if (scrollY < 200) navLinks.forEach(a => a.classList.toggle("active", a.dataset.nav === "dashboard")); }, { passive: true });

const hr = new Date().getHours();
$("greeting").textContent = hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
$("todayLabel").textContent = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

$("transactionRows").innerHTML = Array(4).fill('<tr class="skeleton static"><td colspan="5"><div class="sk"></div></td></tr>').join("");
(async function init() {
  const params = new URLSearchParams(location.search);
  try { auth = { ...auth, ...(await api("/status")) }; } catch {}
  if (params.has("auth_error")) history.replaceState(null, "", "/");
  if (auth.authEnabled && !auth.signedIn) return showLogin(params.get("auth_error") || "");
  if (auth.user) {
    $("accountLine").textContent = `Signed in as ${auth.user.email}`;
    $("signOutBtn").classList.remove("hidden");
  }
  $("storageNote").textContent = auth.mode === "browser" ? "Saved in this browser only" : "Synced with your Google Sheet";
  if (!auth.configured) return showGate();
  refresh().catch(err => { if (err.code !== "SETUP" && err.code !== "AUTH") showToast(err.message); });
})();
