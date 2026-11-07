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
