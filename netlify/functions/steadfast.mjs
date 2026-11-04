export default async (request) => {
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "Content-Type": "application/json" } });
  const bearer = request.headers.get("authorization") || "";
  const token = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
  if (!token) return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: { "Content-Type": "application/json" } });
  try {
    const verify = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
    const identity = await verify.json();
    const expectedProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    if (!verify.ok || !identity.email || identity.email_verified !== "true" || identity.aud !== expectedProject || identity.iss !== "https://securetoken.google.com/" + expectedProject) {
      return new Response(JSON.stringify({ error: "Invalid or expired Firebase sign-in. Please sign in again." }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    if (process.env.STEADFAST_ALLOWED_EMAIL && identity.email.toLowerCase() !== process.env.STEADFAST_ALLOWED_EMAIL.toLowerCase()) {
      return new Response(JSON.stringify({ error: "This account is not allowed to create courier shipments." }), { status: 403, headers: { "Content-Type": "application/json" } });
    }
  } catch {
    return new Response(JSON.stringify({ error: "Could not verify Firebase authentication" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const apiKey = process.env.STEADFAST_API_KEY;
  const secretKey = process.env.STEADFAST_SECRET_KEY;
  if (!apiKey || !secretKey) return new Response(JSON.stringify({ error: "Steadfast credentials are missing. Add STEADFAST_API_KEY and STEADFAST_SECRET_KEY in Netlify environment variables." }), { status: 503, headers: { "Content-Type": "application/json" } });
  try {
    const body = await request.json();
    const required = ["invoice", "recipient_name", "recipient_phone", "recipient_address", "cod_amount"];
    for (const key of required) if (body[key] === undefined || body[key] === null || body[key] === "") return new Response(JSON.stringify({ error: `Missing required field: ${key}` }), { status: 400, headers: { "Content-Type": "application/json" } });
    const cod = Number(body.cod_amount);
    if (!Number.isFinite(cod) || cod < 0) return new Response(JSON.stringify({ error: "cod_amount must be a valid non-negative number" }), { status: 400, headers: { "Content-Type": "application/json" } });
    const upstream = await fetch("https://portal.packzy.com/api/v1/create_order", {
      method: "POST", headers: { "Api-Key": apiKey, "Secret-Key": secretKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...body, cod_amount: cod })
    });
    const raw = await upstream.text();
    let data; try { data = JSON.parse(raw); } catch { data = { message: raw || "Invalid response from Steadfast" }; }
    return new Response(JSON.stringify(data), { status: upstream.status, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || "Unable to contact Steadfast" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
};
