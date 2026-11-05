// CREATIVE.LAB · Función "pago" (Wompi)
// - accion "crear": arma el enlace de pago de Wompi para un plan (firma de integridad).
// - accion "verificar": consulta una transacción en Wompi al volver del pago y activa el plan.
// - sin accion (POST de Wompi): evento de transacción; valida la firma y activa el plan.
import { createClient } from "npm:@supabase/supabase-js@2";
import { PLANES } from "../_planes.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const PUB = Deno.env.get("WOMPI_PUBLIC_KEY") ?? "";
const INTEG = Deno.env.get("WOMPI_INTEGRITY") ?? "";
const EVENTS = Deno.env.get("WOMPI_EVENTS") ?? "";
const API = PUB.startsWith("pub_test") ? "https://sandbox.wompi.co/v1" : "https://production.wompi.co/v1";
const SITIO = "https://logosbymajo.github.io/creative.lab/";

async function sha256(t: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const masMes = (d: string) => { const x = new Date(d + "T12:00:00Z"); x.setUTCMonth(x.getUTCMonth() + 1); return x.toISOString().slice(0, 10); };

async function aplicar(admin: any, tx: any) {
  if (!tx?.reference) return { ok: false, motivo: "sin_referencia" };
  const { data: p } = await admin.from("pagos").select("*").eq("referencia", tx.reference).maybeSingle();
  if (!p) return { ok: false, motivo: "no_existe" };
  if (p.aplicado) return { ok: true, plan: p.plan, ya: true };
  const estado = String(tx.status || "").toLowerCase();
  if (tx.status !== "APPROVED") { await admin.from("pagos").update({ estado, wompi_id: tx.id }).eq("referencia", p.referencia); return { ok: false, motivo: estado }; }
  if (Number(tx.amount_in_cents) !== p.monto * 100 || tx.currency !== "COP") { await admin.from("pagos").update({ estado: "monto_raro", wompi_id: tx.id }).eq("referencia", p.referencia); return { ok: false, motivo: "monto" }; }
  const hoy = new Date().toISOString().slice(0, 10);
  const { data: a } = await admin.from("accesos").select("plan,inicio,fin").eq("email", p.email).maybeSingle();
  let inicio = hoy, fin = masMes(hoy);
  // Renovación del mismo plan antes de vencer: el nuevo mes empieza cuando termina el actual
  if (a?.fin && a.fin >= hoy && a.plan === p.plan) { inicio = a.fin; fin = masMes(a.fin); }
  // Si renueva antes de vencer, mantiene el periodo actual hasta que termine
  const upd = a?.fin && a.fin >= hoy && a.plan === p.plan ? { fin, activo: true } : { plan: p.plan, inicio, fin, activo: true };
  await admin.from("accesos").update(upd).eq("email", p.email);
  await admin.from("pagos").update({ estado: "aprobado", wompi_id: tx.id, aplicado: new Date().toISOString() }).eq("referencia", p.referencia);
  return { ok: true, plan: p.plan };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const body = await req.json().catch(() => ({}));

    // Evento de Wompi
    if (body?.event && body?.signature) {
      const props: string[] = body.signature.properties ?? [];
      const val = (path: string) => path.split(".").reduce((o: any, k) => o?.[k], body.data);
      const cadena = props.map((k) => String(val(k) ?? "")).join("") + String(body.timestamp) + EVENTS;
      if (!EVENTS || (await sha256(cadena)) !== String(body.signature.checksum).toLowerCase()) return json({ error: "firma" }, 401);
      if (body.event === "transaction.updated") await aplicar(admin, body.data?.transaction);
      return json({ ok: true });
    }

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json({ error: "no_sesion" }, 401);
    const email = (u.user.email ?? "").toLowerCase();
    const { data: acc } = await admin.from("accesos").select("email").eq("email", email).maybeSingle();
    if (!acc) return json({ error: "sin_acceso" }, 403);
    if (!PUB || !INTEG) return json({ error: "sin_wompi" }, 503);

    if (body.accion === "crear") {
      const plan = PLANES[body.plan]; if (!plan) return json({ error: "plan" }, 400);
      const referencia = "CL-" + body.plan + "-" + Date.now().toString(36) + "-" + crypto.randomUUID().slice(0, 6);
      const cents = plan.precio * 100;
      await admin.from("pagos").insert({ referencia, email, plan: body.plan, monto: plan.precio });
      const firma = await sha256(referencia + cents + "COP" + INTEG);
      const q = new URLSearchParams({
        "public-key": PUB, currency: "COP", "amount-in-cents": String(cents), reference: referencia,
        "signature:integrity": firma, "redirect-url": SITIO, "customer-data:email": email,
      });
      return json({ url: "https://checkout.wompi.co/p/?" + q.toString() });
    }

    if (body.accion === "verificar") {
      const id = String(body.id ?? "").replace(/[^\w-]/g, ""); if (!id) return json({ error: "id" }, 400);
      const r = await fetch(`${API}/transactions/${id}`);
      if (!r.ok) return json({ error: "wompi" }, 502);
      const tx = (await r.json()).data;
      const { data: p } = await admin.from("pagos").select("email").eq("referencia", tx?.reference ?? "").maybeSingle();
      if (!p || p.email !== email) return json({ error: "no_es_tuyo" }, 403);
      return json(await aplicar(admin, tx));
    }
    return json({ error: "accion" }, 400);
  } catch (e) {
    return json({ error: "fallo", detalle: String(e).slice(0, 200) }, 500);
  }
});
