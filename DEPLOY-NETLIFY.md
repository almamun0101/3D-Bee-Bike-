# Netlify deploy guide (3D Bee + Steadfast)

> ⚠️ Netlify **drag & drop** diye deploy korbe na. Drag & drop e `netlify/functions` upload hoy na, tai Steadfast sync 404 dibe.
> Niche duita option ache. **A (GitHub)** shobcheye shohoj ar update-o auto hoy.

## Step 0 · Environment variables (duita option-i e lagbe)
Netlify → Site configuration → Environment variables → Add:

| Name | Value |
|---|---|
| NEXT_PUBLIC_FIREBASE_API_KEY | Firebase web API key |
| NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN | dbee-ef05d.firebaseapp.com |
| NEXT_PUBLIC_FIREBASE_DATABASE_URL | https://dbee-ef05d-default-rtdb.asia-southeast1.firebasedatabase.app |
| NEXT_PUBLIC_FIREBASE_PROJECT_ID | dbee-ef05d |
| NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET | dbee-ef05d.firebasestorage.app |
| NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID | 1034028465473 |
| NEXT_PUBLIC_FIREBASE_APP_ID | 1:1034028465473:web:7ab6752cc2138a29bd35c0 |
| NEXT_PUBLIC_DB_ROOT | 3dbee v2 |
| NEXT_PUBLIC_REQUIRE_LOGIN | true |
| STEADFAST_API_KEY | tomar Steadfast API key |
| STEADFAST_SECRET_KEY | tomar Steadfast Secret key |

(Tomar `.env.local` e jegulo ache sheigulo-i boshao. `STEADFAST_*` e kokhono `NEXT_PUBLIC_` lagabe na.)
Optional: `STEADFAST_BASE_URL`, `STEADFAST_ALLOWED_EMAIL` (shudhu ei email courier feature use korte parbe).

## Option A · GitHub diye (recommended)
1. Ei folder ta GitHub e (private repo) push koro. `.env.local` git e jay na.
2. Netlify → **Add new site → Import an existing project** → repo select koro.
3. Build settings auto ashbe (`npm run build`, publish `out`, functions `netlify/functions`). Kichu bodlate hobe na.
4. Step 0 er variables boshao, tarpor **Deploy**.
5. Porer bar theke `git push` korlei auto deploy.

## Option B · GitHub chara (Netlify CLI)
```
npm install
npx netlify-cli login
npx netlify-cli link        # ba: npx netlify-cli sites:create
npm run deploy
```
Step 0 er variables Netlify site e age boshiye nio.

## Deploy-er por (must do)
1. **Firebase Console → Authentication → Settings → Authorized domains** e tomar Netlify domain (`tomar-site.netlify.app` ba custom domain) add koro. Na korle login hobe na.
2. Browser e kholo: `https://TOMAR-SITE/.netlify/functions/steadfast-api`
   `{"ok":true,...,"credentialsSet":true}` dekhale function live ache.
3. App e login → **Courier** tab → **Sync everything**.

## Note
- Auto-sync (15 min) tokhoni chole jokhon dashboard browser e khola thake.
- Local e chalate: `npm install` → `npm run dev` (function shoho chole).

## Sticker print (Bluetooth)
- Order drawer → **🖨️ Print sticker (Bluetooth)**. Printer: JP-PT265 (TSC / TSPL), sticker size dropdown default 40×30mm.
- Web Bluetooth shudhu **HTTPS** e (Netlify e ache) ar **Android Chrome / desktop Chrome** e cholbe. iPhone Safari e hobe na.
- Order e **Tracking / parcel ID** na thakle sticker print hobe na.

## v3: automation, monitoring and security setup

### 1. Environment variables (Netlify > Site configuration > Environment variables)
| Variable | Needed for |
|---|---|
| `STEADFAST_API_KEY`, `STEADFAST_SECRET_KEY` | all Steadfast features (already required) |
| `FIREBASE_SERVICE_ACCOUNT` | background sync every 10 min **and** the webhook (writes to Firebase while the dashboard is closed). Paste the whole service-account JSON (or its base64). |
| `STEADFAST_WEBHOOK_TOKEN` | webhook authentication. Choose a long random string. |

Without `FIREBASE_SERVICE_ACCOUNT` the dashboard still syncs, but only while it is open (browser auto-sync every 5 min and on tab focus).
Settings > "Automation & connection status" shows which of these are active.

### 2. Steadfast webhook (instant updates)
In the Steadfast merchant panel add a webhook with URL `https://YOUR-SITE.netlify.app/.netlify/functions/steadfast-webhook`
and the same value as `STEADFAST_WEBHOOK_TOKEN` as the Bearer token. The scheduled sync keeps running as a safety net, so a missed webhook is harmless.
The payload fields used are `notification_type`, `consignment_id`, `invoice`, `status`, `cod_amount`, `delivery_charge`, `tracking_message`, `updated_at`.
Check that field list against the webhook section of your own Steadfast account docs; unknown/unmatched events are answered with 200 and ignored.

### 3. Tracking links
Steadfast's own tracking link is saved when the API returns one. If you know the official tracking page address, put it in
Settings > Tracking link, e.g. `https://example.com/track/{code}` (`{code}` = tracking code, `{id}` = consignment id). No address is built in or guessed.

### 4. Delay thresholds
Settings > Delivery delay thresholds (default 24 / 48 / 72 / 96 hours, "stuck" after 24 h without a courier update). Stored in Firebase at `settings/monitor`.

### 5. Security checklist
- Firebase Console > Authentication > Settings: **disable user sign-ups** (only you should be able to log in). The database rules allow any *signed-in* user.
- Optional, stricter rules (replace the email): `".read": "auth != null && auth.token.email == 'you@example.com'"` and the same for `.write`.
- Steadfast keys and the service account live only in Netlify environment variables, never in `NEXT_PUBLIC_*` and never in git (`.env.local` is git-ignored).
- Security headers are set in `netlify.toml`.

### 6. Tests
- `npm test` - unit + server tests (monitoring logic, webhook, scheduled sync, duplicate-parcel protection) - no network needed.
- `npm run qa` - builds a QA bundle with an in-memory Firebase stand-in (`qa/`, never used in production) and drives the real UI in Chromium with Playwright (desktop, mobile, dark mode). Needs `pip install playwright openpyxl` and `playwright install chromium`.
