// CREATIVE.LAB · Función "ia"
// Recibe el texto (y fotogramas) desde la página, revisa que la persona tenga acceso
// y le pregunta a Claude. La clave de Claude vive aquí, nunca en la página.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const LIMITE = Number(Deno.env.get("LIMITE_DIARIO") ?? "15"); // análisis por persona por día
const MODELO = Deno.env.get("MODELO_IA") ?? "claude-sonnet-5-5";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "metodo" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    // 1) ¿Quién es?
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "no_sesion" }, 401);
    const { data: u, error: ue } = await admin.auth.getUser(token);
    if (ue || !u?.user) return json({ error: "no_sesion" }, 401);
    const user = u.user;
    const email = (user.email ?? "").toLowerCase();

    // 2) ¿Tiene acceso activo?
    const { data: acc } = await admin.from("accesos").select("activo,plan,fin").eq("email", email).maybeSingle();
    if (!acc?.activo) return json({ error: "sin_acceso" }, 403);
    const { data: adm } = await admin.from("admins").select("email").eq("email", email).maybeSingle();
    if (!adm && acc.plan && (!acc.fin || acc.fin < new Date().toISOString().slice(0, 10))) return json({ error: "vencido" }, 402);

    // 3) Límite diario (para cuidar los costos)
    const hoy = new Date().toISOString().slice(0, 10);
    const { data: uso } = await admin.from("uso_ia").select("llamadas").eq("user_id", user.id).eq("dia", hoy).maybeSingle();
    const n = uso?.llamadas ?? 0;
    if (!adm && n >= LIMITE) return json({ error: "limite" }, 429);

    // 4) Armar la conversación
    const body = await req.json().catch(() => ({}));
    let messages: { role: "user" | "assistant"; content: unknown }[] = [];
    if (Array.isArray(body.messages)) {
      messages = body.messages
        .filter((m: any) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
        .slice(-14)
        .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 20000) }));
    } else if (typeof body.prompt === "string" && body.prompt.trim()) {
      messages = [{ role: "user", content: body.prompt.slice(0, 60000) }];
    }
    if (!messages.length || messages[messages.length - 1].role !== "user") return json({ error: "vacio" }, 400);

    const imgs = Array.isArray(body.images) ? body.images.slice(0, 12) : [];
    if (imgs.length) {
      const total = imgs.reduce((a: number, i: any) => a + String(i.data ?? "").length, 0);
      if (total > 9_000_000) return json({ error: "muy_grande" }, 413);
      const last = messages[messages.length - 1];
      last.content = [
        ...imgs
          .filter((i: any) => /^image\/(jpeg|png|webp|gif)$/.test(i.type) && typeof i.data === "string")
          .map((i: any) => ({ type: "image", source: { type: "base64", media_type: i.type, data: i.data } })),
        { type: "text", text: String(last.content) },
      ];
    }

    await admin.from("uso_ia").upsert({ user_id: user.id, dia: hoy, llamadas: n + 1 });

    // 5) Preguntarle a Claude
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: MODELO, max_tokens: 4000, messages }),
    });
    const j = await r.json();
    if (!r.ok) {
      console.error("Claude:", r.status, JSON.stringify(j).slice(0, 500));
      return json({ error: "ia" }, 502);
    }
    const text = (j.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
    if (!text) return json({ error: "ia" }, 502);
    return json({ text });
  } catch (e) {
    console.error(e);
    return json({ error: "interno" }, 500);
  }
});
