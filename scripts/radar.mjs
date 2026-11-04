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
const POR_RUBRO = 5;

for (const [k, v] of Object.entries({ SUPABASE_SECRET_KEY: SB_KEY, APIFY_TOKEN: APIFY, ANTHROPIC_API_KEY: CLAUDE }))
  if (!v) { console.error(`Falta el secreto ${k} en GitHub`); process.exit(1); }

const NOMBRES = {
  "marca-marketing": "Marca personal y marketing (charla a cámara sobre marca, asesoría de marca 1:1, marketing y ventas para emprendedoras; nunca procesos de diseño, logos ni muestras de trabajo)",
  belleza: "Belleza, uñas y estética", moda: "Moda y accesorios", comida: "Comida y repostería",
  fitness: "Fitness, salud y bienestar", educacion: "Cursos, coaching y educación",
  hogar: "Hogar, decoración y manualidades", mascotas: "Mascotas", ventas: "Emprendimiento y ventas",
};
// Hashtags por rubro: inglés (EE. UU./Canadá), portugués (Brasil), alemán, ruso
const TAGS = {
  "marca-marketing": [["personalbranding", "marketingtips", "womeninbusiness", "brandstrategy", "femaleentrepreneur", "smallbusinesstips"], ["marcapessoal", "empreendedorismofeminino", "dicasdemarketing", "posicionamento"], ["marketingtipps", "personalbrand", "selbststaendig"], ["личныйбренд", "маркетинг", "бизнесдляженщин"]],
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

function elegirTags(rubro, extra) {
  const grupos = TAGS[rubro];
  if (!grupos) return extra;
  // 2 de inglés + 1 de portugués + 1 rotando entre alemán y ruso; cambia cada día
  const pick = (arr, k) => arr[(diaDelAnio + k) % arr.length];
  return [pick(grupos[0], 0), pick(grupos[0], 1), pick(grupos[1], 0), pick(diaDelAnio % 2 ? grupos[2] : grupos[3], 0)];
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

  // 2) Videos que ya tenemos
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
        body: JSON.stringify({ hashtags: tags, resultsPerPage: 12, downloadSubtitlesOptions: "NEVER_DOWNLOAD_SUBTITLES" }),
      });
      if (!r.ok) throw new Error("Apify " + r.status + " " + (await r.text()).slice(0, 200));
      const items = await r.json();

      // 4) Filtro con números
      const cand = items.filter((v) => {
        const vis = v.playCount || 0, fans = v.authorMeta?.fans || 0, com = v.commentCount || 0;
        const lang = v.textLanguage || "";
        const esEspana = v.locationMeta?.countryCode === "ES";
        if (ya.has("tt-" + v.id)) return false;
        if (lang === "es" && !esEspana) return false;
        if (com < 100) return false;
        return (vis >= 100000 && vis >= 3 * fans) || (vis >= 30000 && vis >= 10 * fans);
      }).sort((a, b) => (b.playCount / Math.max(1, b.authorMeta?.fans || 1)) - (a.playCount / Math.max(1, a.authorMeta?.fans || 1)))
        .slice(0, 25);
      console.log(`[${rubro}] ${items.length} encontrados, ${cand.length} pasan los números`);
      if (!cand.length) { resumen.push(`${rubro}: 0`); continue; }

      // 5) Claude elige y analiza
      const lista = cand.map((v) => ({
        id: v.id, idioma: v.textLanguage, pais: v.locationMeta?.countryCode || null, vistas: v.playCount, comentarios: v.commentCount,
        seguidores: v.authorMeta?.fans || 0, duracion: v.videoMeta?.duration || 0, texto: String(v.text || "").slice(0, 600),
      }));
      const prompt = `Eres el Radar de CREATIVE.LAB. Traes videos virales del "segundo internet" (otros idiomas y mercados: Brasil, Estados Unidos, España, Alemania, Canadá, Rusia) para que creadoras hispanohablantes los reestrenen en español con su voz.
Rubro: ${NOMBRES[rubro] || inf.otro}. ${inf.nicho ? "Nicho de referencia: " + inf.nicho + "." : ""} ${inf.enfoque ? "Cómo es el contenido de quienes lo usan: " + inf.enfoque + "." : ""}
Método: Instagram premia la retención. Todo viral tiene ESQUELETO (gancho, promesa, orden, ritmo, giro, cierre) y PIEL (persona, idioma, tema, fondo). Se conserva el esqueleto y se cambia la piel.
De esta lista, elige como máximo ${POR_RUBRO} videos que de verdad sean del rubro, que una sola persona pueda repetir con su celular y que respeten el enfoque. Descarta rifas, ventas puras de un producto, contenido sin relación (por ejemplo "branding" de ganado), y para marca-marketing todo lo que sea proceso de diseño, logos o portafolio.
Lista (JSON): ${JSON.stringify(lista)}
Responde SOLO con un JSON array. Cada elemento:
{"id":"<id>","mercado":"Brasil|Estados Unidos|España|Alemania|Canadá|Rusia|Otro","idioma":"<código real: en, pt, de, ru, es, fr...>","titulo":"<frase principal del original, corta, en su idioma; si es ruso u otro alfabeto, tradúcela al español>","formato":"<nombre corto del formato>","por_que_funciona":"<2 frases: qué del esqueleto retiene y por qué comentan>","por_que_para_ti":"<1-2 frases: cómo se lleva a este rubro para emprendedoras hispanohablantes>","gancho_adaptado":"<el gancho en español latino, cercano, para decir a cámara>","filtros":{"ya_funciono":"si|no|duda","repetible":"si|no|duda","tu_tema":"si|no|duda","espanol":"duda"}}
Escribe natural, nada que suene a IA. Si ninguno sirve, responde [].`;
      const txt = await claude(prompt);
      const elegidos = JSON.parse((txt.match(/\[[\s\S]*\]/) || ["[]"])[0]);
      const porId = new Map(cand.map((v) => [String(v.id), v]));
      const filas = [];
      elegidos.slice(0, POR_RUBRO).forEach((e, i) => {
        const v = porId.get(String(e.id)); if (!v) return;
        filas.push({
          id: "tt-" + v.id, rubro,
          encontrado: new Date(Date.now() - i * 10000).toISOString(),
          datos: {
            plataforma: "TikTok", url: v.webVideoUrl, caption: String(v.text || "").slice(0, 600),
            vistas: v.playCount, comentarios: v.commentCount, seguidores: v.authorMeta?.fans || 0, duracion: v.videoMeta?.duration || 0,
            mercado: e.mercado, idioma: e.idioma || v.textLanguage, titulo: e.titulo, formato: e.formato,
            por_que_funciona: e.por_que_funciona, por_que_para_ti: e.por_que_para_ti, gancho_adaptado: e.gancho_adaptado, filtros: e.filtros,
          },
        });
        ya.add("tt-" + v.id);
      });
      if (filas.length) await sb("radar", { method: "POST", body: JSON.stringify(filas), headers: { Prefer: "resolution=ignore-duplicates,return=minimal" } });
      console.log(`[${rubro}] guardados: ${filas.length}`);
      resumen.push(`${rubro}: ${filas.length}`);
    } catch (e) {
      console.error(`[${rubro}] error:`, e.message);
      resumen.push(`${rubro}: error`);
    }
  }

  // 6) Limpieza: dejar los 600 más recientes
  const todos = await sb("radar?select=id&order=encontrado.desc&offset=600&limit=1000");
  for (const t of todos) await sb(`radar?id=eq.${encodeURIComponent(t.id)}`, { method: "DELETE" });

  console.log("Resumen:", resumen.join(" · "));
}

main().catch((e) => { console.error(e); process.exit(1); });
