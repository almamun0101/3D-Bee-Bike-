// Brand / page settings used by the thank-you sticker and the customer messages. Stored in Firebase at settings/brand.
// The page link is NEVER guessed: until you enter it, the thank-you sticker prints without a QR code.
export const DEFAULT_BRAND = { pageName: "3D Bee", pageUrl: "", tagline: "Share a photo & tag us!", banglaLine: true, thankYou: true };

export function normalizeBrand(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const str = (v, max, dflt) => { const t = typeof v === "string" ? v.trim().slice(0, max) : ""; return t || dflt; };
  const url = typeof r.pageUrl === "string" ? r.pageUrl.trim() : "";
  return {
    pageName: str(r.pageName, 40, DEFAULT_BRAND.pageName),
    pageUrl: /^https?:\/\/[^\s]+\.[^\s]+$/i.test(url) && url.length <= 200 ? url : "",
    tagline: typeof r.tagline === "string" ? r.tagline.trim().slice(0, 60) : DEFAULT_BRAND.tagline,
    banglaLine: r.banglaLine === undefined ? DEFAULT_BRAND.banglaLine : !!r.banglaLine,
    thankYou: r.thankYou === undefined ? DEFAULT_BRAND.thankYou : !!r.thankYou
  };
}
