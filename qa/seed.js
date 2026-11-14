// QA only: synthetic orders that exercise every monitoring state. Times are relative to "now" so tiers are deterministic.
const H = 3600000;
export function seed(now) {
  const ago = h => new Date(now - h * H).toISOString();
  const orders = {};
  let n = 0;
  const add = (id, o) => { n++; orders[id] = { customerName: "Customer " + id, customerDetails: "House 1, Road 2, Dhaka", courierRecipientPhone: "017" + String(10000000 + n * 137).slice(0, 8), courierRecipientAddress: "House 1, Road 2, Dhaka", bikeNumbers: "DHAKA-METRO-HA " + (11 + n) + "-" + (1000 + n), total: 600 + n * 10, paidAmount: 100, paymentStatus: "Paid Advance", orderStatus: "Pending", createdAt: ago(200 - n * 3), orderDate: new Date(now - (200 - n * 3) * H).toISOString().slice(0, 10), serial: n, items: [{ name: "DHAKA-METRO-HA " + (11 + n), side: "Front Side", type: "BRTA", qty: 1, price: 600 + n * 10 }], ...o }; };
  const sf = (id, h, extra = {}, o = {}) => add(id, { courierName: "Steadfast", courierId: "9" + id.padStart(5, "0"), orderStatus: "Shipped", deliveryStatus: "In transit", steadfastStatus: "pending", steadfastCreatedAt: ago(h), shippedAt: ago(h), steadfastStatusChangedAt: ago(Math.min(h, 2)), steadfastLastEventAt: ago(Math.min(h, 2)), steadfastSyncedAt: ago(0.1), steadfastCodAmount: 500, ...extra, ...o });
  sf("t0", 10); sf("t1", 30); sf("t2", 55); sf("t3", 80); sf("t4", 120);
  sf("hold", 15, { steadfastStatus: "hold", deliveryStatus: "On hold", steadfastTrackingMessage: "Customer not reachable" });
  sf("stuck", 20, { steadfastLastEventAt: ago(40), steadfastStatusChangedAt: ago(40) });
  add("failed", { courierName: "Steadfast", courierId: "9FAIL", orderStatus: "Shipped", steadfastSyncError: "ID not found on Steadfast", steadfastSyncFailures: 4, steadfastSyncedAt: ago(1), steadfastCreatedAt: ago(5), shippedAt: ago(5) });
  sf("deliv", 60, { steadfastStatus: "delivered", steadfastDeliveredAt: ago(30), steadfastCodSettled: true, steadfastCodAmount: 500, steadfastStatusChangedAt: ago(30) }, { orderStatus: "Completed", paymentStatus: "Paid Full", paidAmount: 700, deliveryStatus: "Delivered" });
  sf("ret", 90, { steadfastStatus: "cancelled", steadfastReturnedAt: ago(40), steadfastStatusChangedAt: ago(40) }, { orderStatus: "Returned", deliveryStatus: "Returned" });
  sf("fudue", 26, { followUpAt: ago(1), followUpNote: "Call the Mirpur hub" });
  sf("fulater", 26, { followUpAt: new Date(now + 5 * H).toISOString(), followUpNote: "Ask again tonight" });
  add("ready", { orderStatus: "Ready to ship", customerName: "Rahim Uddin", courierRecipientPhone: "01711111111" });
  add("ready2", { orderStatus: "Ready to ship", customerName: "Rahim Uddin", courierRecipientPhone: "01711111111", paymentStatus: "Unpaid", paidAmount: 0 });
  add("pend", { orderStatus: "Pending", customerName: "Karim", instructions: "Black plate, bold font", internalNotes: [{ text: "Customer asked for fast delivery", at: ago(5), by: "qa" }] });
  for (let i = 0; i < 18; i++) add("f" + i, { orderStatus: ["Completed", "Pending", "Printing", "Cancelled", "Processing"][i % 5], paymentStatus: ["Paid Full", "Unpaid", "Paid Advance"][i % 3], createdAt: ago(10 + i * 26), orderDate: new Date(now - (10 + i * 26) * H).toISOString().slice(0, 10), total: 500 + i * 55 });
  return { orders, settings: {}, expenses: { e1: { name: "Filament", category: "Materials", amount: 1200, createdAt: ago(48) } } };
}
