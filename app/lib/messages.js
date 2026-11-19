// Customer messages in Bangla (order confirmation, shipping update, thank-you). Pure functions - no network, no guessing:
// every amount comes from the order, the page link only appears when it was configured.
import { getDue, num, itemsOfOrder, phoneOf, addressOf, trackingIdOf } from "./shared.js";

const BN = "০১২৩৪৫৬৭৮৯";
export const toBn = s => String(s).replace(/\d/g, d => BN[d]);
const VEH = { Bike: "বাইক", Scooter: "স্কুটার" };

export function messageKind(o) {
  const st = String(o?.orderStatus || "");
  if (/^(delivered|completed)$/i.test(st)) return "thanks";
  if (/^shipped$/i.test(st) || (trackingIdOf(o) && /ready|ship/i.test(st))) return "shipping";
  return "confirm";
}
export const KIND_LABEL = { confirm: "✅ অর্ডার কনফার্মেশন", shipping: "🚚 শিপিং আপডেট", thanks: "🙏 ডেলিভারি ও ধন্যবাদ" };

// Bangladesh mobile -> number for https://wa.me/<number> (country code, digits only)
export const whatsappNumber = phone => { const p = String(phone || "").replace(/[\s-]/g, "").replace(/^\+?88/, ""); return /^01\d{9}$/.test(p) ? "88" + p : ""; };

export function banglaMessage(o, serial, { kind, brand = {}, link = "", bnDigits = true } = {}) {
  const k = kind || messageKind(o), d = x => (bnDigits ? toBn(x) : String(x));
  const taka = n => `${d(Number(n).toLocaleString("en-US"))} টাকা`;
  const total = num(o?.total), due = getDue(o), paid = Math.max(0, total - due), fee = num(o?.deliveryFee);
  const name = String(o?.customerName || "").trim() || "গ্রাহক";
  const phone = phoneOf(o), addr = addressOf(o), id = trackingIdOf(o);
  const no = serial ? ` #${d(serial)}` : "";
  const items = itemsOfOrder(o).filter(i => i.name);
  const lines = [`প্রিয় ${name},`];

  const itemLines = () => items.map((i, n) => {
    const q = Math.max(1, num(i.qty)), side = i.side === "Back Side" ? "পেছনের" : "সামনের";
    return `${d(n + 1)}) ${i.name} — ${VEH[i.vehicle] || VEH.Bike} ${side} প্লেট (${i.type === "Custom" ? "কাস্টম সাইজ" : "BRTA সাইজ"}) × ${d(q)} = ${taka(q * num(i.price))}`;
  });
  const dueLine = () => (due > 0 ? `⏳ বাকি টাকা: ${taka(due)} (ডেলিভারির সময় পরিশোধ করতে হবে)` : "✅ সম্পূর্ণ টাকা পরিশোধিত");
  const page = () => [brand.pageName ? `— ${brand.pageName}` : "", brand.pageUrl || ""].filter(Boolean);

  if (k === "confirm") {
    lines.push(`আপনার অর্ডারটি সফলভাবে গ্রহণ করা হয়েছে ✅`, `অর্ডার নম্বর:${no || " —"}`, "", "📋 অর্ডারের বিবরণ:", ...itemLines());
    if (fee > 0) lines.push(`🚚 ডেলিভারি চার্জ: ${taka(fee)}${fee === 80 ? " (ঢাকার ভেতরে)" : fee === 130 ? " (ঢাকার বাইরে)" : ""}`);
    lines.push(`💰 সর্বমোট: ${taka(total)}`, `✅ পরিশোধিত: ${taka(paid)}`, dueLine(), "");
    if (addr) lines.push(`📍 ডেলিভারি ঠিকানা: ${addr}`);
    if (phone) lines.push(`📞 মোবাইল: ${phone}`);
    if (o?.instructions) lines.push(`📝 নোট: ${o.instructions}`);
    lines.push("", "অনুগ্রহ করে তথ্যগুলো একবার দেখে নিন। কোনো পরিবর্তন থাকলে আমাদের জানাবেন।", "আপনার অর্ডারের কাজ শুরু করা হচ্ছে। ধন্যবাদ 🙏", ...page());
  } else if (k === "shipping") {
    lines.push(`আপনার অর্ডার${no} কুরিয়ারে পাঠানো হয়েছে 🚚`);
    if (o?.courierName) lines.push(`কুরিয়ার: ${o.courierName}`);
    if (id) lines.push(`ট্র্যাকিং আইডি: ${id}`);
    if (link) lines.push(`ট্র্যাকিং লিংক: ${link}`);
    lines.push("", due > 0 ? `💰 ডেলিভারির সময় কুরিয়ারকে দিতে হবে: ${taka(due)}` : "✅ আপনার কোনো টাকা বাকি নেই", "", "কুরিয়ার প্রতিনিধি ফোন করলে অনুগ্রহ করে রিসিভ করবেন 📞", "ধন্যবাদ 🙏", ...page());
  } else {
    lines.push(`আপনার অর্ডার${no} সফলভাবে ডেলিভারি হয়েছে 🎉`, "আমাদের সাথে থাকার জন্য আন্তরিক ধন্যবাদ 🙏", "", "প্লেট কেমন লাগলো জানাবেন। ছবি তুলে আমাদের পেজে ট্যাগ করলে খুব খুশি হবো।", ...page());
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
