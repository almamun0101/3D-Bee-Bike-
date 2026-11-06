# 3D Bee Order Desk — Next.js + Firebase Realtime Database

A live order-management dashboard for 3D Bee. Orders are stored in Firebase Realtime Database at `/3dbee v2/orders`; all signed-in dashboards subscribe to the same database path and receive changes in real time.

## Included features
- Firebase Email/Password admin sign-in
- Realtime order updates across browsers/devices
- Add, edit, delete and quick-update order/payment status
- Realtime sync status and last-sync indicator
- Delivery partner, parcel ID, tracking URL and delivery status
- Sales, outstanding payments, recorded costs and estimated profit dashboard
- Payment ledger with partial payments, delivery-charge-paid tracking, and automatically recalculated highlighted due
- Steadfast Courier shipment creation through a server-side Netlify Function (credentials never exposed to the browser)
- Production, delivery and miscellaneous cost fields; amount received tracking
- Basic order status timeline for newly created and edited orders
- Search every order field, filter, sort and CSV export
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


## Payment and Steadfast setup

- Outstanding due is `total - paidAmount - deliveryChargePaidAmount`, never below zero.
- Use **Record payment** in an order drawer for money received by your business. The app stores a payment-history entry and reduces due.
- Use **Mark delivery charge paid** only when the customer has paid the courier/delivery fee separately. It deducts only the unpaid delivery-fee portion from due; it does not mark the product amount as paid.
- Steadfast shipment creation sends the remaining due as `cod_amount`. Add the recipient phone and complete address in the order form first.
- In Netlify → Site configuration → Environment variables, add `STEADFAST_API_KEY` and `STEADFAST_SECRET_KEY` from your Steadfast merchant account. These must be server-side variables (never prefix with `NEXT_PUBLIC_`). Redeploy after adding them.
- The request is proxied by `netlify/functions/steadfast.mjs`; the browser never receives the API secret.
- Existing orders remain compatible: missing `deliveryChargePaidAmount` is treated as zero, and existing `paidAmount` values are preserved.


## Courier tab, auto-sync and Analytics (new)
- Order er **Tracking / parcel ID** = Steadfast ID. Dashboard ta oi ID diye Steadfast e match kore status niye ashe (`steadfastStatus`, `deliveryStatus`) ar Firebase e save kore. Delivered hole order status auto "Delivered" hoy.
- **Courier tab**: koto parcel courier e gelo (courier wise), on the way / delivered / cancelled, COD kothay, 5+ din atke thaka parcel, ID mile nai emon order, Steadfast payments (COD, charge, received, balance) ar customer name match.
- **Analytics tab**: sales, profit, margin, due, daily/weekly/monthly chart, status, courier performance, weekday, area, expenses, top customers, smart insights.
- Auto-sync: dashboard khola thakle prottek 15 min e on-the-way parcel gulo sync hoy (Courier tab e off kora jay).
- New Netlify function: `netlify/functions/steadfast-api.mjs` (status, balance, payments). Same Netlify env vars (`STEADFAST_API_KEY`, `STEADFAST_SECRET_KEY`) lage.

## Local run with Steadfast sync
`npm run dev` now starts the Steadfast functions together with Next.js (plain `npm run dev:next` has none and gives 404):

```
npm install
npm run dev
```
This starts Next.js on http://localhost:3000 and the Steadfast functions on http://localhost:8888. Put `STEADFAST_API_KEY` and `STEADFAST_SECRET_KEY` in `.env.local` (restart after changing).

## Auto rules (Steadfast sync)
- **Delivered** (customer received): COD collected -> paid = full, due = 0, payment "Paid Full", order "Delivered", activity log added. Partial delivery is NOT auto-settled (check COD manually).
- **Cancelled / returned by Steadfast**: order status becomes "Returned". Loss = production cost + other cost + courier charge. Shown in Courier tab (Returns & loss), Orders stats and Analytics; revenue of returned parcels is not counted.
- **Courier cost check**: your assumed cost (order "Delivery cost") vs Steadfast's real charge. Red "▲ +৳50 beshi" when Steadfast charged more, green when less.
- Payment dropdown: choosing **Delivery Charge Paid** fills the delivery charge paid amount automatically and recalculates due.
- Bill / Paid / Due are shown together in one cell.
