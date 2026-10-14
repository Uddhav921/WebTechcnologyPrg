# FinTrack – Finance Controller

A personal finance dashboard (Node.js + Express). **Every record is stored only in your Google Sheet** – there is no
local database. Optional **Sign in with Google** controls who can open the dashboard. Dashboard and sheet stay in sync both ways:

- Add / edit / delete in the dashboard → the sheet updates immediately.
- Type or change rows in the sheet → the dashboard picks them up within ~15 seconds (or when you return to the tab).

## Connect your Google Sheet (one-time, ~3 minutes)

1. Open your Google Sheet → **Extensions → Apps Script**.
2. Delete the sample code, paste everything from `apps-script/Code.gs`, and change this line to your own long random text:
   ```js
   const SECRET = "CHANGE_ME_TO_A_LONG_RANDOM_TEXT";
   ```
   Click **Save**.
3. **Deploy → New deployment** → gear icon → **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**, approve the permission prompt (Advanced → Go to project → Allow), and copy the **Web app URL**
     (it ends with `/exec`).
4. In this folder: `cp .env.example .env`, then set
   ```
   SHEETS_WEB_APP_URL=<the Web app URL>
   SHEETS_SECRET=<the same secret text from Code.gs>
   ```
5. Run:
   ```bash
   npm install
   npm start        # http://localhost:3000
   ```

On first use the script creates a **Transactions** tab with these columns:

| Date | Title | Type | Category | Amount | Note | ID (auto) | Created At |
|------|-------|------|----------|--------|------|-----------|------------|

Notes
- `Type` is `income` or `expense`. Dates can be real dates or text like `2026-10-14` / `14/10/2026` (day first).
- Rows you type by hand get an ID filled in automatically. Don't edit **ID** or **Created At**.
- Don't leave blank rows between records. Deleting a row in the sheet removes it from the dashboard.
- If you change `Code.gs` later, use **Deploy → Manage deployments → Edit → New version** so the change goes live.

## Sign in with Google (recommended)

This adds a login screen so only people you approve can open the dashboard. It only asks Google for your name and
email – it never gets access to your spreadsheets (the Apps Script above does that part).

1. Go to <https://console.cloud.google.com/> and create (or pick) a project.
2. **APIs & Services → OAuth consent screen** (Google Auth Platform): user type **External**, fill in an app name and
   your email, keep it in **Testing**, and add the emails that will sign in under **Test users**.
3. **Credentials → Create credentials → OAuth client ID** → **Web application** → add this
   **Authorised redirect URI**: `http://localhost:3000/auth/callback` (change the port if you changed `PORT`).
4. Put the values in `.env` and restart:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ALLOWED_EMAILS=you@gmail.com,family@gmail.com
   SESSION_SECRET=any-long-random-text
   ```
   Only the emails in `ALLOWED_EMAILS` can get in; everyone else is turned away even if Google lets them sign in.
   If `GOOGLE_CLIENT_ID` is set without `ALLOWED_EMAILS`, the app refuses to start.
5. Open the app → **Sign in with Google**. Use **Sign out** at the bottom of the page to log out. Sessions last 7 days.

If you leave the Google sign-in values blank, the dashboard opens without a login – fine on your own computer only.

## Security

"Anyone" access means the Web app URL is reachable without a Google login, so it is protected by your **SECRET**:
requests without the right secret are rejected. Use a long random secret, keep `.env` and the Web app URL private,
and never commit `.env`. The script can only touch the spreadsheet it is attached to.
The dashboard server listens on `127.0.0.1` only. Without Google sign-in it has no login at all, so don't expose it to the internet; with sign-in on, keep it local anyway unless you serve it over HTTPS.

## Troubleshooting

| Message | Fix |
|---|---|
| "didn't answer correctly" | Redeploy the Web app with **Who has access: Anyone** and check `SHEETS_WEB_APP_URL` ends in `/exec`. |
| "Unauthorized: the secret does not match" | `SHEETS_SECRET` in `.env` must exactly equal `SECRET` in `Code.gs`. |
| "Set your SECRET in Code.gs first" | Replace the placeholder secret in `Code.gs` and redeploy a new version. |
| `redirect_uri_mismatch` | The redirect URI in Google Cloud must exactly match `http://localhost:3000/auth/callback`. |
| `access_denied` / "app not verified" | Add your email under **OAuth consent screen → Test users**, then choose *Continue*. |
| "… is not allowed to use this app" | Add that email to `ALLOWED_EMAILS` in `.env` and restart. |
| Signed out after every restart | Set `SESSION_SECRET` in `.env`. |
| Changes in the sheet don't appear | Wait ~15 s or refocus the tab; make sure edits are on the **Transactions** tab. |
