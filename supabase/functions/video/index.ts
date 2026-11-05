// CREATIVE.LAB · Función "video"
// Recibe el enlace de un video de TikTok o Instagram, lo baja con Apify y devuelve
// lo que dice, sus cifras, sus comentarios y la portada, para que la IA lo analice.
import { createClient } from "npm:@supabase/supabase-js@2";
import { PLANES } from "../_planes.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const LIMITE = Number(Deno.env.get("LIMITE_DIARIO") ?? "15");
const APIFY = Deno.env.get("APIFY_TOKEN")!;
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function apify(actor: string, input: unknown) {
  const r = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${APIFY}&timeout=120&maxTotalChargeUsd=0.5`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error("apify " + r.status + " " + (await r.text()).slice(0, 200));
  return await r.json();
}
async function texto(url?: string) {
  if (!url) return "";
  try {
    const r = await fetch(url.includes("api.apify.com") && !url.includes("token=") ? url + (url.includes("?") ? "&" : "?") + "token=" + APIFY : url);
    if (!r.ok) return "";
    const t = await r.text();
    return t.replace(/^WEBVTT.*$/m, "").replace(/\d\d:\d\d[:.\d]* --> [\d:.]+.*$/gm, "").replace(/^\d+$/gm, "").replace(/\n{2,}/g, "\n").trim().slice(0, 8000);
  } catch { return ""; }
}
async function imagen(url?: string) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const type = (r.headers.get("content-type") ?? "image/jpeg").split(";")[0];
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > 3_000_000) return null;
    let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { type, data: btoa(s) };
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json({ error: "no_sesion" }, 401);
    const email = (u.user.email ?? "").toLowerCase();
    const { data: acc } = await admin.from("accesos").select("activo,plan,inicio,fin").eq("email", email).maybeSingle();
    if (!acc?.activo) return json({ error: "sin_acceso" }, 403);
    const { data: adm } = await admin.from("admins").select("email").eq("email", email).maybeSingle();
    const hoy = new Date().toISOString().slice(0, 10);
    const cuerpo = await req.clone().json().catch(() => ({}));
    // Plan del mes: cada video reestrenado cuenta una vez por periodo
    if (!adm && acc.plan && PLANES[acc.plan]) {
      if (!acc.fin || acc.fin < hoy) return json({ error: "vencido" }, 402);
      const link0 = String(cuerpo?.url ?? "").trim().split("?")[0];
      if (link0) {
        const { data: ya } = await admin.from("reestrenos").select("url").eq("user_id", u.user.id).eq("periodo", acc.inicio).eq("url", link0).maybeSingle();
        if (!ya) {
          const { count } = await admin.from("reestrenos").select("url", { count: "exact", head: true }).eq("user_id", u.user.id).eq("periodo", acc.inicio);
          if ((count ?? 0) >= PLANES[acc.plan].videos) return json({ error: "sin_videos" }, 402);
          await admin.from("reestrenos").insert({ user_id: u.user.id, url: link0, periodo: acc.inicio });
        }
      }
    }
    const { data: uso } = await admin.from("uso_ia").select("llamadas").eq("user_id", u.user.id).eq("dia", hoy).maybeSingle();
    const n = uso?.llamadas ?? 0;
    if (!adm && n >= LIMITE) return json({ error: "limite" }, 429);
    await admin.from("uso_ia").upsert({ user_id: u.user.id, dia: hoy, llamadas: n + 1 });

    const { url } = await req.json().catch(() => ({}));
    const link = String(url ?? "").trim();

    if (/tiktok\.com/i.test(link)) {
      const items = await apify("clockworks~tiktok-scraper", {
        postURLs: [link], resultsPerPage: 1, commentsPerPost: 12,
        downloadSubtitlesOptions: "DOWNLOAD_AND_TRANSCRIBE_VIDEOS_WITHOUT_SUBTITLES",
      });
      const v = items?.[0];
      if (!v || v.error) return json({ error: "no_abre" }, 404);
      const subs = v.videoMeta?.subtitleLinks ?? [];
      const sub = subs.find((s: any) => /^(en|pt|de|ru|es|fr)/i.test(s.language ?? "")) ?? subs[0];
      let dice = await texto(sub?.downloadLink);
      if (!dice) dice = await texto(v.videoMeta?.transcriptionLink);
      let comentarios: string[] = [];
      if (v.commentsDatasetUrl) {
        try {
          const c = await (await fetch(v.commentsDatasetUrl + (v.commentsDatasetUrl.includes("?") ? "&" : "?") + "token=" + APIFY + "&limit=12")).json();
          comentarios = (Array.isArray(c) ? c : []).map((x: any) => String(x.text ?? "")).filter(Boolean).slice(0, 12);
        } catch { /* sin comentarios */ }
      }
      return json({
        plataforma: "TikTok", url: v.webVideoUrl ?? link, idioma: v.textLanguage ?? "", cuenta: v.authorMeta?.name ?? "",
        caption: String(v.text ?? "").slice(0, 2000), vistas: v.playCount ?? 0, likes: v.diggCount ?? 0, comentarios_n: v.commentCount ?? 0,
        guardados: v.collectCount ?? 0, compartidos: v.shareCount ?? 0, seguidores: v.authorMeta?.fans ?? 0, duracion: v.videoMeta?.duration ?? 0,
        dice, comentarios, portada: await imagen(v.videoMeta?.coverUrl ?? v.videoMeta?.originalCoverUrl),
      });
    }

    if (/instagram\.com\/(reel|reels|p|tv)\//i.test(link)) {
      const items = await apify("apify~instagram-scraper", { directUrls: [link], resultsType: "posts", resultsLimit: 1 });
      const v = items?.[0];
      if (!v || v.error) return json({ error: "no_abre" }, 404);
      return json({
        plataforma: "Instagram", url: v.url ?? link, idioma: "", cuenta: v.ownerUsername ?? "",
        caption: String(v.caption ?? "").slice(0, 2000), vistas: v.videoPlayCount ?? v.videoViewCount ?? 0, likes: v.likesCount ?? 0,
        comentarios_n: v.commentsCount ?? 0, guardados: 0, compartidos: 0, seguidores: 0, duracion: Math.round(v.videoDuration ?? 0),
        dice: "", comentarios: (v.latestComments ?? []).map((c: any) => String(c.text ?? "")).filter(Boolean).slice(0, 12),
        portada: await imagen(v.displayUrl),
      });
    }

    return json({ error: "no_soportado" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "no_abre" }, 502);
  }
});
