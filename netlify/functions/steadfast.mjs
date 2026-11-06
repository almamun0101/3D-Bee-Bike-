import { verifyUser } from "../shared/steadfast.mjs";

export default async (request) => {
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "Content-Type": "application/json" } });
  const auth = await verifyUser(request);
  if (auth.error) return auth.error;
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
