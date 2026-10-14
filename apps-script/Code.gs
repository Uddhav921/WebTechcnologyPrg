/**
 * FinTrack – Google Sheet backend (Google Apps Script)
 *
 * Paste this into: your Google Sheet → Extensions → Apps Script.
 * 1) Change SECRET below to your own long random text (same value goes in the app's .env).
 * 2) Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone → Deploy.
 */
const SECRET = "CHANGE_ME_TO_A_LONG_RANDOM_TEXT";
const TAB = "Transactions";
const HEADERS = ["Date", "Title", "Type", "Category", "Amount", "Note", "ID (auto)", "Created At"];

function doGet() { return out_({ ok: true, message: "FinTrack endpoint is running" }); }

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const req = JSON.parse(e.postData.contents);
    if (SECRET === "CHANGE_ME_TO_A_LONG_RANDOM_TEXT") return out_({ error: "Set your SECRET in Code.gs first." });
    if (req.secret !== SECRET) return out_({ error: "Unauthorized: the secret does not match." });
    const sh = sheet_();
    switch (req.action) {
      case "list": return out_({ items: readAll_(sh).map(strip_) });
      case "add": {
        const t = req.item;
        sh.appendRow([toDate_(t.date), t.title, t.type, t.category, t.amount, t.note || "", t.id, t.createdAt]);
        return out_({ item: t });
      }
      case "update": {
        const cur = readAll_(sh).find(x => x.id === req.id);
        if (!cur) return out_({ item: null });
        const n = Object.assign({}, strip_(cur), req.fields);
        sh.getRange(cur._row, 1, 1, 8).setValues([[toDate_(n.date), n.title, n.type, n.category, n.amount, n.note || "", n.id, n.createdAt]]);
        return out_({ item: n });
      }
      case "remove": {
        const cur = readAll_(sh).find(x => x.id === req.id);
        if (!cur) return out_({ removed: false });
        sh.deleteRow(cur._row);
        return out_({ removed: true });
      }
      default: return out_({ error: "Unknown action" });
    }
  } catch (err) {
    return out_({ error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(TAB);
  if (!sh) sh = ss.insertSheet(TAB);
  if (sh.getRange(1, 1).getValue() === "") {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold").setBackground("#e3f4f1");
    sh.setFrozenRows(1);
    sh.getRange("A2:A").setNumberFormat("dd mmm yyyy");
    sh.getRange("E2:E").setNumberFormat("#,##0.00");
  }
  return sh;
}

function toDate_(iso) {
  const p = String(iso).split("-").map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

function toIso_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, "yyyy-MM-dd");
  const s = String(v == null ? "" : v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); // day-first, e.g. 14/10/2026
  if (m) return m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
  return Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
}

function toNum_(v) {
  const n = typeof v === "number" ? v : Number(String(v == null ? "" : v).replace(/[₹,\s]/g, ""));
  return isFinite(n) ? Math.abs(n) : 0;
}

function strip_(o) { const c = Object.assign({}, o); delete c._row; return c; }

function readAll_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const values = sh.getRange(2, 1, last - 1, 8).getValues();
  const items = [];
  values.forEach(function (r, i) {
    const row = i + 2;
    if (r[1] === "" && r[4] === "") return; // blank row
    let id = r[6], created = Number(r[7]) || i;
    if (!id) { // row typed by hand: give it an ID so the dashboard can edit/delete it
      id = Utilities.getUuid(); created = Date.now() + i;
      sh.getRange(row, 7, 1, 2).setValues([[id, created]]);
    }
    items.push({
      id: String(id), title: String(r[1] || "").trim() || "Untitled", amount: toNum_(r[4]),
      type: /^inc/i.test(String(r[2])) ? "income" : "expense", category: String(r[3] || "").trim() || "Other",
      date: toIso_(r[0], tz), note: String(r[5] || ""), createdAt: created, _row: row
    });
  });
  return items;
}
