# 3D Bee Order Desk — Netlify deployment

## Build settings
- Build command: `npm run build`
- Publish directory: `out`
- Node version: `20` (also specified in `.nvmrc`)

## Required Netlify environment variables
Add these under **Site configuration → Environment variables**. Use the exact Firebase Web App values from Firebase Console → Project settings → Your apps.

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` = `dbee-ef05d.firebaseapp.com`
- `NEXT_PUBLIC_FIREBASE_DATABASE_URL` = `https://dbee-ef05d-default-rtdb.asia-southeast1.firebasedatabase.app`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID` = `dbee-ef05d`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` = `dbee-ef05d.firebasestorage.app`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` = `1034028465473`
- `NEXT_PUBLIC_FIREBASE_APP_ID` = `1:1034028465473:web:7ab6752cc2138a29bd35c0`
- `NEXT_PUBLIC_DB_ROOT` = `3dbee v2`
- `NEXT_PUBLIC_REQUIRE_LOGIN` = `true`

After changing environment variables, run **Deploys → Trigger deploy → Clear cache and deploy site**. Next.js `NEXT_PUBLIC_` variables are embedded at build time; changing them without rebuilding will not update the deployed browser bundle.

## Firebase checklist
1. Enable Authentication → Sign-in method → Email/Password.
2. Add the Netlify site hostname under Authentication → Settings → Authorized domains.
3. Publish database rules that match the app's root path. Do not use public read/write rules for production.
4. The app reads and writes `/3dbee v2/orders` and `/3dbee v2/expenses`.

## If the page still fails
Open the deployed site, press F12, select Console, and copy the first red error plus its stack trace. Also inspect Netlify → Deploys → latest deploy → Deploy log. The app now shows a Firebase configuration message when required variables are missing and includes a Next.js route error screen for uncaught render errors.

## Local run
Copy `.env.local.example` to `.env.local`, fill in the Firebase API key, then run:

```bash
npm install
npm run dev
```

## Steadfast sync (Courier tab)
Add `STEADFAST_API_KEY` and `STEADFAST_SECRET_KEY` (server-side) in Netlify, then redeploy. The function `steadfast-api` verifies the Firebase sign-in before calling Steadfast. Optional: `STEADFAST_BASE_URL`, `STEADFAST_ALLOWED_EMAIL`.

### "Request failed (404)" on Steadfast sync
The function is not deployed. Check: open `https://YOUR-SITE.netlify.app/.netlify/functions/steadfast-api` in the browser. You should see `{"ok":true,...}`.
- Deploy with **Git (GitHub) or Netlify CLI** (`npx netlify deploy --prod --build`). Drag-and-drop of only the `out` folder does NOT upload `netlify/functions`.
- Local testing: `npm run dev` (plain `npm run dev` has no Netlify functions).
