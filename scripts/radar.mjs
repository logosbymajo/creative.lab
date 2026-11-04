// CREATIVE.LAB · Radar diario
// Busca en TikTok (con Apify) videos de otros idiomas que están pegando, por rubro,
// los filtra, los analiza con Claude y los guarda en Supabase.
// Corre solo cada mañana desde GitHub Actions (.github/workflows/radar.yml).

const SB_URL = process.env.SUPABASE_URL || "https://qqwlgbcrdiyklvyjebbx.supabase.co";
const SB_KEY = process.env.SUPABASE_SECRET_KEY;      // sb_secret_... (secreto de GitHub)
const APIFY = process.env.APIFY_TOKEN;               // token de Apify (secreto de GitHub)
const CLAUDE = process.env.ANTHROPIC_API_KEY;        // clave de Claude (secreto de GitHub)
const MODELO = process.env.MODELO_IA || "claude-sonnet-5-5";
const RUBROS_POR_DIA = Number(process.env.RUBROS_POR_DIA || "3"); // marca-marketing + 2 rotando
const POR_RUBRO = 6;
const MIN_VISTAS = 800000;
const MIN_LIKES = 25000; // filtro de popularidad de Apify (un video de 800 mil vistas suele tener más de 25 mil me gusta)
const IDIOMAS = ["en", "pt", "de", "ru", "fr"]; // Estados Unidos, Canadá, Brasil, Alemania, Rusia (nada en español)

for (const [k, v] of Object.entries({ SUPABASE_SECRET_KEY: SB_KEY, APIFY_TOKEN: APIFY, ANTHROPIC_API_KEY: CLAUDE }))
  if (!v) { console.error(`Falta el secreto ${k} en GitHub`); process.exit(1); }

const NOMBRES = {
  "marca-marketing": "Marca personal y marketing: una persona hablando a cámara (charla, consejo, opinión, mini clase) sobre marketing, crecimiento personal, cómo crecer en redes sociales, estrategia de marca, consejos de logo y branding, y asesorías de marca para emprendedoras. NO sirven videos mostrando procesos de diseño, creación de logos con nombres ni portafolios",
  gatos: "Gatos y criaderos de gatos de raza (Ragdoll, Ragamuffin, Siberiano, Angora turco): consejos de un criador, cuidados del gatito, alimentación, salud, características de cada raza, qué preguntar antes de comprar un gatito, mitos y verdades, presentación de camadas y día a día del criadero",
  belleza: "Belleza, uñas y estética", moda: "Moda y accesorios", comida: "Comida y repostería",
  fitness: "Fitness, salud y bienestar", educacion: "Cursos, coaching y educación",
  hogar: "Hogar, decoración y manualidades", mascotas: "Mascotas", ventas: "Emprendimiento y ventas",
};
// Hashtags por rubro: inglés (EE. UU./Canadá), portugués (Brasil), alemán, ruso
const TAGS = {
  "marca-marketing": [["personalbranding", "marketingtips", "socialmediatips", "brandstrategy", "instagramgrowth", "brandingtips", "personalgrowth", "contentstrategy", "logotips", "femaleentrepreneur"], ["marcapessoal", "dicasdemarketing", "dicasdeinstagram", "desenvolvimentopessoal", "branding", "posicionamento"], ["marketingtipps", "instagramtipps", "persoenlichkeitsentwicklung"], ["личныйбренд", "маркетинг", "саморазвитие", "продвижение"]],
  gatos: [["ragdollcat", "ragamuffincat", "siberiancat", "turkishangora", "catbreeder", "kittencare", "cattips"], ["gatoragdoll", "gatosiberiano", "dicasdegato", "filhotedegato"], ["ragdollkatze", "sibirischekatze", "katzenzucht"], ["рэгдолл", "сибирскаякошка", "питомниккошек"]],
  belleza: [["nailtech", "beautytips", "lashtech", "estheticianlife"], ["unhasdecoradas", "designdesobrancelhas", "dicasdebeleza"], ["nageldesign", "beautytipps"], ["маникюр", "бьюти", "бровист"]],
  moda: [["fashiontips", "outfitideas", "smallbusinessfashion", "styletips"], ["modafeminina", "dicasdemoda", "lojadeprimeira"], ["modetipps", "outfitinspo"], ["мода", "стиль", "образ"]],
  comida: [["baking", "cakedecorating", "foodbusiness", "homebaker"], ["confeitaria", "bolodepote", "receitasfaceis"], ["backen", "kuchenrezept"], ["выпечка", "торты", "рецепты"]],
  fitness: [["fitnesstips", "personaltrainer", "healthyhabits", "wellnesscoach"], ["dicasfitness", "treinoemcasa", "personaltrainer"], ["fitnesstipps", "abnehmen"], ["фитнес", "тренировка", "зож"]],
  educacion: [["onlinecoach", "coursecreator", "businesscoach", "teachersoftiktok"], ["mentoria", "infoprodutor", "educacao"], ["coaching", "onlinekurs"], ["коучинг", "обучение", "наставник"]],
  hogar: [["homedecor", "diycrafts", "organizationtips", "handmadebusiness"], ["decoracao", "artesanato", "organizacaodecasa"], ["dekoideen", "basteln"], ["декор", "рукоделие", "уютныйдом"]],
  mascotas: [["dogtips", "petbusiness", "catsoftiktok", "doggrooming"], ["petshop", "dicaspet", "banhoetosa"], ["hundetipps", "haustiere"], ["собаки", "груминг", "питомцы"]],
  ventas: [["smallbusinesstips", "salestips", "entrepreneurtips", "sidehustle"], ["empreendedorismo", "dicasdevendas", "vendasonline"], ["unternehmer", "verkaufen"], ["предприниматель", "продажи", "бизнес"]],
};

const hoy = new Date();
const diaDelAnio = Math.floor((hoy - new Date(hoy.getFullYear(), 0, 0)) / 864e5);

async function sb(path, opts = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal", ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${path}: ${r.status} ${await r.text()}`);
  return r.status === 204 || opts.method === "DELETE" || (opts.method === "POST" && !opts.headers?.Prefer?.includes("representation")) ? null : r.json();
}

async function claude(prompt) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": CLAUDE, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODELO, max_tokens: 6000, messages: [{ role: "user", content: prompt }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Claude: " + JSON.stringify(j).slice(0, 300));
  return j.content.filter((c) => c.type === "text").map((c) => c.text).join("");
}

async function asegurarBucket() {
  const r = await fetch(`${SB_URL}/storage/v1/bucket`, {
    method: "POST", headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: "portadas", name: "portadas", public: true }),
  });
  if (!r.ok) { const t = await r.text(); if (!/exist|duplicate/i.test(t)) console.log("bucket:", r.status, t.slice(0, 200)); }
}
async function subirPortada(id, url) {
  if (!url) return null;
  try {
    const img = await fetch(url);
    if (!img.ok) return null;
    const type = (img.headers.get("content-type") || "image/jpeg").split(";")[0];
    const buf = Buffer.from(await img.arrayBuffer());
    if (buf.length < 1000 || buf.length > 3_000_000) return null;
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    const up = await fetch(`${SB_URL}/storage/v1/object/portadas/${id}.${ext}`, {
      method: "POST", headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": type, "x-upsert": "true" }, body: buf,
    });
    if (!up.ok) { console.log("portada:", up.status, (await up.text()).slice(0, 150)); return null; }
    return `${SB_URL}/storage/v1/object/public/portadas/${id}.${ext}`;
  } catch { return null; }
}
const portadaDe = (v) => v.videoMeta?.coverUrl || v.videoMeta?.originalCoverUrl || null;

function elegirTags(rubro, extra) {
  const grupos = TAGS[rubro];
  if (!grupos) return extra;
  // 2 de inglés + 1 de portugués + 1 de alemán + 1 de ruso; cambian cada día
  const pick = (arr, k) => arr[(diaDelAnio + k) % arr.length];
  return [pick(grupos[0], 0), pick(grupos[0], 1), pick(grupos[1], 0), pick(grupos[2], 0), pick(grupos[3], 0)];
}

async function main() {
  // 1) Rubros activos
  const perfiles = await sb("perfiles?select=rubro,rubro_otro,datos&rubro=not.is.null");
  const cuenta = new Map();
  const info = new Map();
  for (const p of perfiles) {
    const key = p.rubro === "otro" ? "otro:" + String(p.rubro_otro || "").toLowerCase().trim() : p.rubro;
    if (key === "otro:") continue;
    cuenta.set(key, (cuenta.get(key) || 0) + 1);
    if (!info.has(key)) info.set(key, { nicho: p.datos?.nicho || "", enfoque: p.datos?.enfoque || "", otro: p.rubro_otro || "" });
  }
  const otros = [...cuenta.keys()].filter((k) => k !== "marca-marketing").sort((a, b) => cuenta.get(b) - cuenta.get(a));
  const n = Math.max(0, RUBROS_POR_DIA - 1);
  const rot = otros.length ? Array.from({ length: Math.min(n, otros.length) }, (_, i) => otros[(diaDelAnio * n + i) % otros.length]) : [];
  const rubros = ["marca-marketing", ...new Set(rot)];
  console.log("Rubros de hoy:", rubros.join(", "));

  await asegurarBucket();

  // 2) Videos que ya tenemos (y limpieza: menos de 800 mil vistas o en otros idiomas)
  const actuales = await sb("radar?select=id,datos&limit=5000");
  for (const r of actuales) {
    const vis = Number(r.datos?.vistas || 0), lang = String(r.datos?.idioma || "").slice(0, 2);
    if (vis < MIN_VISTAS || !IDIOMAS.includes(lang)) await sb(`radar?id=eq.${encodeURIComponent(r.id)}`, { method: "DELETE" });
  }
  const sinPortada = actuales.filter((r) => Number(r.datos?.vistas || 0) >= MIN_VISTAS && IDIOMAS.includes(String(r.datos?.idioma || "").slice(0, 2)) && !r.datos?.portada && r.datos?.url);
  if (sinPortada.length) {
    try {
      const rr = await fetch(`https://api.apify.com/v2/acts/clockworks~tiktok-scraper/run-sync-get-dataset-items?token=${APIFY}&timeout=200&maxTotalChargeUsd=0.5`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postURLs: sinPortada.slice(0, 40).map((r) => r.datos.url), resultsPerPage: 1 }),
      });
      const vids = rr.ok ? await rr.json() : [];
      for (const v of vids) {
        const fila = sinPortada.find((r) => r.id === "tt-" + v.id); if (!fila) continue;
        const pu = await subirPortada(fila.id, portadaDe(v));
        if (pu) await sb(`radar?id=eq.${encodeURIComponent(fila.id)}`, { method: "PATCH", body: JSON.stringify({ datos: { ...fila.datos, portada: pu } }) });
      }
      console.log("Portadas recuperadas:", vids.length);
    } catch (e) { console.log("portadas viejas:", e.message); }
  }
  const ya = new Set((await sb("radar?select=id&limit=5000")).map((r) => r.id));
  const resumen = [];

  for (const rubro of rubros) {
    try {
      const inf = info.get(rubro) || {};
      let tags = elegirTags(rubro, []);
      if (!tags.length) {
        const t = await claude(`Dame 4 hashtags populares de TikTok (sin #, sin espacios) para el rubro "${inf.otro}" (${inf.nicho}): 2 en inglés, 1 en portugués y 1 en alemán o ruso. Responde solo un JSON array de strings.`);
        tags = JSON.parse(t.match(/\[[\s\S]*\]/)[0]).slice(0, 4);
      }
      console.log(`[${rubro}] hashtags:`, tags.join(", "));

      // 3) Apify
      const r = await fetch(`https://api.apify.com/v2/acts/clockworks~tiktok-scraper/run-sync-get-dataset-items?token=${APIFY}&timeout=290&maxTotalChargeUsd=0.5`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hashtags: tags, resultsPerPage: 15, leastDiggs: MIN_LIKES, downloadSubtitlesOptions: "NEVER_DOWNLOAD_SUBTITLES" }),
      });
      if (!r.ok) throw new Error("Apify " + r.status + " " + (await r.text()).slice(0, 200));
      const items = await r.json();

      // 4) Filtro con números
      const cand = items.filter((v) => {
        const vis = v.playCount || 0, fans = v.authorMeta?.fans || 0, com = v.commentCount || 0;
        const lang = (v.textLanguage || "").slice(0, 2);
        if (ya.has("tt-" + v.id)) return false;
        if (!IDIOMAS.includes(lang)) return false;
        if (com < 200) return false;
        return vis >= MIN_VISTAS && vis >= 1.5 * fans;
      }).sort((a, b) => (b.playCount / Math.max(1, b.authorMeta?.fans || 1)) - (a.playCount / Math.max(1, a.authorMeta?.fans || 1)))
        .slice(0, 25);
      console.log(`[${rubro}] ${items.length} encontrados, ${cand.length} pasan los números`);
      if (!cand.length) { resumen.push(`${rubro}: 0`); continue; }

      // 5) Claude elige y analiza
      const lista = cand.map((v) => ({
        id: v.id, idioma: v.textLanguage, pais: v.locationMeta?.countryCode || null, vistas: v.playCount, comentarios: v.commentCount,
        seguidores: v.authorMeta?.fans || 0, duracion: v.videoMeta?.duration || 0, texto: String(v.text || "").slice(0, 600),
      }));
      const prompt = `Eres el Radar de CREATIVE.LAB. Traes videos virales del "segundo internet" (otros idiomas y mercados: Brasil, Estados Unidos, Alemania, Canadá, Rusia; nunca videos en español) para que creadoras hispanohablantes los reestrenen en español con su voz.
Rubro: ${NOMBRES[rubro] || inf.otro}. ${inf.nicho ? "Nicho de referencia: " + inf.nicho + "." : ""} ${inf.enfoque ? "Cómo es el contenido de quienes lo usan: " + inf.enfoque + "." : ""}
Método: Instagram premia la retención. Todo viral tiene ESQUELETO (gancho, promesa, orden, ritmo, giro, cierre) y PIEL (persona, idioma, tema, fondo). Se conserva el esqueleto y se cambia la piel.
De esta lista, elige como máximo ${POR_RUBRO} videos que de verdad sean del rubro, que una sola persona pueda repetir con su celular y que respeten el enfoque. Descarta videos en español, rifas, ventas puras de un producto, contenido sin relación (por ejemplo "branding" de ganado), y para marca-marketing todo lo que sea proceso de diseño, logos con nombres o portafolio.
Lista (JSON): ${JSON.stringify(lista)}
Responde SOLO con un JSON array. Cada elemento:
{"id":"<id>","mercado":"Brasil|Estados Unidos|Alemania|Canadá|Rusia","idioma":"<código real: en, pt, de, ru o fr>","titulo":"<frase principal del original, corta, en su idioma; si es ruso u otro alfabeto, tradúcela al español>","formato":"<nombre corto del formato>","por_que_funciona":"<2 frases: qué del esqueleto retiene y por qué comentan>","por_que_para_ti":"<1-2 frases: cómo se lleva a este rubro para emprendedoras hispanohablantes>","gancho_adaptado":"<el gancho en español latino, cercano, para decir a cámara>","filtros":{"ya_funciono":"si|no|duda","repetible":"si|no|duda","tu_tema":"si|no|duda","espanol":"duda"}}
Escribe natural, nada que suene a IA. Intenta que haya variedad de idiomas (inglés, portugués, alemán, ruso) si hay buenos candidatos en cada uno. Si ninguno sirve, responde [].`;
      const txt = await claude(prompt);
      const elegidos = JSON.parse((txt.match(/\[[\s\S]*\]/) || ["[]"])[0]);
      const porId = new Map(cand.map((v) => [String(v.id), v]));
      const filas = [];
      for (const [i, e] of elegidos.slice(0, POR_RUBRO).entries()) {
        const v = porId.get(String(e.id)); if (!v) continue;
        const portada = await subirPortada("tt-" + v.id, portadaDe(v));
        filas.push({
          id: "tt-" + v.id, rubro,
          encontrado: new Date(Date.now() - i * 10000).toISOString(),
          datos: {
            plataforma: "TikTok", url: v.webVideoUrl, caption: String(v.text || "").slice(0, 600),
            vistas: v.playCount, comentarios: v.commentCount, seguidores: v.authorMeta?.fans || 0, duracion: v.videoMeta?.duration || 0,
            mercado: e.mercado, idioma: e.idioma || v.textLanguage, titulo: e.titulo, formato: e.formato,
            por_que_funciona: e.por_que_funciona, por_que_para_ti: e.por_que_para_ti, gancho_adaptado: e.gancho_adaptado, filtros: e.filtros,
            portada,
          },
        });
        ya.add("tt-" + v.id);
      }
      if (filas.length) await sb("radar", { method: "POST", body: JSON.stringify(filas), headers: { Prefer: "resolution=ignore-duplicates,return=minimal" } });
      console.log(`[${rubro}] guardados: ${filas.length}`);
      resumen.push(`${rubro}: ${filas.length}`);
    } catch (e) {
      console.error(`[${rubro}] error:`, e.message);
      resumen.push(`${rubro}: error`);
    }
  }

  // 6) Limpieza: quitar lo que no sea de los mercados elegidos y dejar los 600 más recientes
  const todos = await sb("radar?select=id&order=encontrado.desc&offset=600&limit=1000");
  for (const t of todos) await sb(`radar?id=eq.${encodeURIComponent(t.id)}`, { method: "DELETE" });

  console.log("Resumen:", resumen.join(" · "));
  console.log("::notice::Radar: " + resumen.join(" · "));
}

main().catch((e) => { console.error(e); process.exit(1); });
