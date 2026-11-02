# 3D Bee Order Desk — Next.js + Firebase Realtime Database

A live order-management dashboard for 3D Bee. Orders are stored in Firebase Realtime Database at `/3dbee v2/orders`; all signed-in dashboards subscribe to the same database path and receive changes in real time.

## Included features
- Firebase Email/Password admin sign-in
- Realtime order updates across browsers/devices
- Add, edit, delete and quick-update order/payment status
- Realtime sync status and last-sync indicator
- Delivery partner, parcel ID, tracking URL and delivery status
- Sales, outstanding payments, recorded costs and estimated profit dashboard
- Production, delivery and miscellaneous cost fields; amount received tracking
- Basic order status timeline for newly created and edited orders
- Search every order field including bike-number item descriptions, filter, sort and CSV export
- Multi-bike-number orders: one number per line or comma-separated; quantity is counted automatically
- Exact duplicate bike numbers are blocked across orders and within an order; similar numbers are flagged while entering
- Responsive desktop table and mobile cards
- Detail drawer includes extra fields stored on each order
- Connection indicator and visible Firebase permission/configuration errors

## Run locally
1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Keep the supplied `.env.local` in the project root, or copy `.env.local.example` to `.env.local` and fill in the Firebase Web App configuration.
4. Run `npm run dev` and open `http://localhost:3000`.

After changing `.env.local`, restart the development server. `NEXT_PUBLIC_*` values are embedded into the browser bundle; the Firebase Web API key is not a server credential. Never put a Firebase service-account private key in this file.

## Firebase setup required (one-time)
1. In Firebase Console, open project `dbee-ef05d`.
2. Authentication → Sign-in method → enable **Email/Password**.
3. Authentication → Users → add the admin email/password you will use on the login screen.
4. Realtime Database → Rules: copy `database.rules.json`, publish the rules. These rules allow every authenticated Firebase user to read and write this node; for a private admin-only dashboard, restrict the rules to your admin email.
5. Confirm the Realtime Database instance is the Asia Southeast 1 database configured in `.env.local`.

The rules intentionally deny unauthenticated access. Do not change them to public read/write rules to bypass a login problem. For admin-only access, use a stricter email-based rule. The current rule is authenticated-user access, matching the rules you supplied.

## Database structure

```json
{
  "3dbee v2": {
    "orders": {
      "-FirebaseGeneratedKey": {
        "customerName": "Customer name",
        "quantity": 1,
        "unitPrice": 250,
        "total": 250,
        "paymentStatus": "Unpaid",
        "orderStatus": "Pending",
        "createdAt": "ISO-8601 timestamp",
        "updatedAt": "ISO-8601 timestamp"
      }
    },
    "expenses": {
      "-FirebaseGeneratedKey": {
        "name": "Filament purchase",
        "category": "Materials",
        "amount": 1200,
        "createdAt": "ISO-8601 timestamp"
      }
    }
  }
}
```

The app writes each new order under a Firebase-generated key and listens to `/3dbee v2/orders` and `/3dbee v2/expenses`. Changes sync live to every signed-in dashboard. Existing data is not overwritten or migrated on startup. The earlier project build used `/3dbeev1/orders`; if your actual orders are still stored there, set `NEXT_PUBLIC_DB_ROOT=3dbeev1` instead of `3dbee v2` to keep viewing that data, or migrate the records in Firebase Console before switching roots.

## Production build
- `npm run build` creates a static export in `out/` (`output: "export"` in `next.config.mjs`).
- Host the contents of `out/` on a static host such as Netlify or Firebase Hosting.
- Add the same `NEXT_PUBLIC_*` environment variables to the hosting provider's build environment, then rebuild/redeploy after changing them.

## Troubleshooting
- **Sign-in failed:** check that Email/Password is enabled and the admin user exists in Firebase Authentication.
- **Permission denied:** publish `database.rules.json` and confirm the signed-in account is authenticated.
- **Connected but no orders:** check whether the existing records are actually under `/3dbee v2/orders`. If they are under another root, change `NEXT_PUBLIC_DB_ROOT` in `.env.local` and rebuild/restart.
- **Offline indicator:** check internet connectivity and the Realtime Database URL/region.
