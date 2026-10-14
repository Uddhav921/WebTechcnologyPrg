// Stores all records in a Google Sheet through a small Google Apps Script web app (apps-script/Code.gs).
// No Google sign-in / OAuth is needed: requests are authorised with a shared secret.
class SheetError extends Error { constructor(message, status = 502) { super(message); this.status = status; } }

function createSheetStore({ url, secret }) {
  let cache = null, cacheAt = 0, queue = Promise.resolve();
  const enqueue = fn => { const p = queue.then(fn); queue = p.catch(() => {}); return p; };

  async function call(action, payload = {}) {
    let res, text;
    try {
      res = await fetch(url, { method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ secret, action, ...payload }) });
      text = await res.text();
    } catch {
      throw new SheetError("Could not reach Google. Check your internet connection and try again.");
    }
    let data;
    try { data = JSON.parse(text); }
    catch { throw new SheetError("Your Google Sheet script didn't answer correctly. Redeploy it as a Web app with access set to \"Anyone\" and check SHEETS_WEB_APP_URL."); }
    if (data.error) throw new SheetError(data.error);
    return data;
  }

  return {
    list: () => enqueue(async () => {
      if (cache && Date.now() - cacheAt < 3000) return cache;
      cache = (await call("list")).items || []; cacheAt = Date.now();
      return cache;
    }),
    add: item => enqueue(async () => { await call("add", { item }); cache = null; return item; }),
    update: (id, fields) => enqueue(async () => { const r = await call("update", { id, fields }); cache = null; return r.item; }),
    remove: id => enqueue(async () => { const r = await call("remove", { id }); cache = null; return !!r.removed; })
  };
}
module.exports = { createSheetStore };
