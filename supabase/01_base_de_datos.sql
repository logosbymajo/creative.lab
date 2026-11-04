-- =====================================================
-- CREATIVE.LAB · Base de datos (pegar completo y darle Run)
-- =====================================================

-- 1) Correos con acceso (los que tú autorizas cuando compran)
create table if not exists public.accesos (
  email   text primary key check (email = lower(email)),
  nombre  text,
  activo  boolean not null default true,
  nota    text,
  creado  timestamptz not null default now()
);

-- 2) Administradoras (tú)
create table if not exists public.admins (
  email text primary key check (email = lower(email))
);
insert into public.admins (email) values ('logosbymajo.studiocreativo@gmail.com') on conflict do nothing;
insert into public.accesos (email, nombre, nota) values ('logosbymajo.studiocreativo@gmail.com','María José','Administradora') on conflict do nothing;

-- 3) Funciones de seguridad
create or replace function public.mi_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt()->>'email','')) $$;

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where email = public.mi_email())
$$;

create or replace function public.tiene_acceso() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.accesos where email = public.mi_email() and activo)
$$;

-- ¿Este correo compró? (la usa la pantalla "Mandarme el enlace")
create or replace function public.puede_entrar(correo text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.accesos where email = lower(trim(correo)) and activo)
$$;
grant execute on function public.puede_entrar(text) to anon, authenticated;

-- Nadie puede crear cuenta si su correo no está en accesos
create or replace function public.solo_con_acceso() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.accesos where email = lower(new.email) and activo) then
    raise exception 'Este correo no tiene acceso a CREATIVE.LAB';
  end if;
  return new;
end $$;
drop trigger if exists antes_de_crear_usuaria on auth.users;
create trigger antes_de_crear_usuaria before insert on auth.users
  for each row execute function public.solo_con_acceso();

-- Panel: ver quién ya creó su cuenta y cuándo entró por última vez
create or replace function public.admin_usuarias()
returns table (email text, creada timestamptz, ultimo_ingreso timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select lower(u.email)::text, u.created_at, u.last_sign_in_at
  from auth.users u where public.es_admin()
$$;
grant execute on function public.admin_usuarias() to authenticated;

-- 4) Perfiles (uno por usuaria)
create table if not exists public.perfiles (
  user_id     uuid primary key references auth.users on delete cascade default auth.uid(),
  email       text default public.mi_email(),
  datos       jsonb not null default '{}'::jsonb,
  rubro       text,
  rubro_otro  text,
  actualizado timestamptz not null default now()
);

-- 5) Videos del radar (los escribe la búsqueda diaria)
create table if not exists public.radar (
  id         text primary key,
  rubro      text not null,
  datos      jsonb not null,
  encontrado timestamptz not null default now()
);
create index if not exists radar_rubro_fecha on public.radar (rubro, encontrado desc);

-- 6) Guiones guardados y videos descartados (por usuaria)
create table if not exists public.guardados (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users on delete cascade default auth.uid(),
  tipo      text,
  titulo    text,
  contenido text,
  creado    timestamptz not null default now()
);
create table if not exists public.descartes (
  user_id  uuid not null references auth.users on delete cascade default auth.uid(),
  video_id text not null,
  primary key (user_id, video_id)
);

-- 7) Control de uso de la IA (para cuidar tus costos)
create table if not exists public.uso_ia (
  user_id  uuid not null references auth.users on delete cascade,
  dia      date not null default current_date,
  llamadas int  not null default 0,
  primary key (user_id, dia)
);

-- 8) Reglas de privacidad (RLS)
alter table public.accesos   enable row level security;
alter table public.admins    enable row level security;
alter table public.perfiles  enable row level security;
alter table public.radar     enable row level security;
alter table public.guardados enable row level security;
alter table public.descartes enable row level security;
alter table public.uso_ia    enable row level security;

drop policy if exists "admin maneja accesos" on public.accesos;
create policy "admin maneja accesos" on public.accesos for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists "admin ve admins" on public.admins;
create policy "admin ve admins" on public.admins for select to authenticated using (public.es_admin());

drop policy if exists "mi perfil" on public.perfiles;
create policy "mi perfil" on public.perfiles for all to authenticated
  using (user_id = auth.uid() and public.tiene_acceso())
  with check (user_id = auth.uid() and public.tiene_acceso());
drop policy if exists "admin ve perfiles" on public.perfiles;
create policy "admin ve perfiles" on public.perfiles for select to authenticated using (public.es_admin());

drop policy if exists "con acceso ve radar" on public.radar;
create policy "con acceso ve radar" on public.radar for select to authenticated using (public.tiene_acceso());

drop policy if exists "mis guardados" on public.guardados;
create policy "mis guardados" on public.guardados for all to authenticated
  using (user_id = auth.uid() and public.tiene_acceso())
  with check (user_id = auth.uid() and public.tiene_acceso());

drop policy if exists "mis descartes" on public.descartes;
create policy "mis descartes" on public.descartes for all to authenticated
  using (user_id = auth.uid() and public.tiene_acceso())
  with check (user_id = auth.uid() and public.tiene_acceso());

drop policy if exists "mi uso" on public.uso_ia;
create policy "mi uso" on public.uso_ia for select to authenticated using (user_id = auth.uid());

-- 9) Tus primeros 7 videos del radar
insert into public.radar (id, rubro, datos, encontrado) values
  ('tt-7453083751019466006','marca-marketing',$j${"caption": "Customers don’t care about you. THIS is what marketing really is about. #marketingtips #neuromarketing #salestips", "comentarios": 1998, "duracion": 24, "filtros": {"espanol": "duda", "repetible": "si", "tu_tema": "si", "ya_funciono": "si"}, "formato": "Frase polémica + explicación corta", "gancho_adaptado": "A tus clientas no les importa tu emprendimiento. Y no es grosero, es la clave para venderles.", "idioma": "en", "plataforma": "TikTok", "por_que_funciona": "Abre con una frase que pica (“a tus clientes no les importas”) y en 24 segundos da la vuelta: lo que les importa es su problema. Es tan corto que se ve completo y la frase provoca debate en comentarios.", "por_que_para_ti": "Es charla pura, sin mostrar diseños. Le habla directo a la emprendedora que solo publica sobre su producto, y abre la puerta a una asesoría 1:1.", "seguidores": 241200, "titulo": "Customers don’t care about you. THIS is what marketing really is about.", "url": "https://www.tiktok.com/@conversion.doc/video/7453083751019466006", "vistas": 3000000, "mercado": "Estados Unidos"}$j$::jsonb, now() - interval '3 minutes'),
  ('tt-7671041826958167310','marca-marketing',$j${"caption": "Your personal brand needs a destination...most people jump straight to content. Start with the outcome instead. Figure out what you actually want your brand to unlock, then work backwards.", "comentarios": 449, "duracion": 67, "filtros": {"espanol": "duda", "repetible": "si", "tu_tema": "si", "ya_funciono": "si"}, "formato": "Conversación / consejo de mentor", "gancho_adaptado": "Si no sabes qué publicar es porque no sabes a dónde quieres que te lleve tu marca.", "idioma": "en", "plataforma": "TikTok", "por_que_funciona": "Señala un error que casi todos cometen (empezar publicando sin saber para qué) y da un cambio de enfoque simple. La cuenta es pequeña y el video tiene 29 veces sus seguidores: el esqueleto es el que retiene.", "por_que_para_ti": "Es lo que se trabaja en una asesoría 1:1: primero a dónde quieres llegar con tu marca y después qué publicar.", "seguidores": 10500, "titulo": "Your personal brand needs a destination… most people jump straight to content.", "url": "https://www.tiktok.com/@theanatomyofadream/video/7671041826958167310", "vistas": 305000, "mercado": "Estados Unidos"}$j$::jsonb, now() - interval '4 minutes'),
  ('tt-7552975714593656075','marca-marketing',$j${"caption": "Como construir uma marca/branding pessoal em 3 pilares.", "comentarios": 600, "duracion": 264, "filtros": {"espanol": "duda", "repetible": "si", "tu_tema": "si", "ya_funciono": "si"}, "formato": "Clase corta: 3 pilares", "gancho_adaptado": "Tu marca personal se sostiene en 3 pilares. Si te falla uno, por eso no te están comprando.", "idioma": "pt", "plataforma": "TikTok", "por_que_funciona": "Promete un método concreto con número (3 pilares) y lo explica uno por uno. La gente se queda para completar la lista y comenta en cuál está fallando: 600 comentarios con solo 13 mil seguidores.", "por_que_para_ti": "Te posiciona como experta hablando, sin mostrar trabajos. Puedes cerrar invitando a trabajar los 3 pilares contigo.", "seguidores": 13500, "titulo": "Como construir uma marca pessoal em 3 pilares", "url": "https://www.tiktok.com/@aultimaideia/video/7552975714593656075", "vistas": 112600, "mercado": "Brasil"}$j$::jsonb, now() - interval '5 minutes'),
  ('tt-7676313946596379934','marca-marketing',$j${"caption": "How to start a clothing brand with under $1,000 💰 Start small, recoup your inventory money, stack your business profit, then scale. Brand School Ep. 1", "comentarios": 846, "duracion": 59, "filtros": {"espanol": "duda", "repetible": "si", "tu_tema": "si", "ya_funciono": "si"}, "formato": "Serie “Escuela de marca”, episodio 1", "gancho_adaptado": "Cómo arrancar la marca de tu emprendimiento con menos de 500 mil pesos. Episodio 1.", "idioma": "en", "plataforma": "TikTok", "por_que_funciona": "Promesa concreta con cifra baja (menos de 1.000 dólares) que hace sentir que sí se puede, y lo arma como serie con episodios. Tiene 28 veces sus seguidores y la gente comenta su caso.", "por_que_para_ti": "Puedes hacer tu propia serie para emprendedoras: cómo arrancar tu marca con poco presupuesto, hablando a cámara, episodio por episodio.", "seguidores": 15900, "titulo": "How to start a clothing brand with under $1,000", "url": "https://www.tiktok.com/@introvertjy_/video/7676313946596379934", "vistas": 447100, "mercado": "Estados Unidos"}$j$::jsonb, now() - interval '6 minutes'),
  ('tt-7692086305441991954','marca-marketing',$j${"caption": "The shame of building personal brands, especially online, has been unfairly foisted on the individual… might there be ways to show up online that feel self-actualized?", "comentarios": 670, "duracion": 112, "filtros": {"espanol": "duda", "repetible": "si", "tu_tema": "si", "ya_funciono": "si"}, "formato": "Reflexión / charla honesta", "gancho_adaptado": "¿Te da pena mostrarte en redes para vender tu emprendimiento? Hablemos de eso.", "idioma": "en", "plataforma": "TikTok", "por_que_funciona": "Habla de algo que muchas sienten y nadie dice: la vergüenza de mostrarse en redes. La identificación hace que se queden y comenten su propia experiencia.", "por_que_para_ti": "A muchas emprendedoras les da pena aparecer en cámara. Esta charla conecta con ellas y abre la conversación.", "seguidores": 79800, "titulo": "The shame of building a personal brand online", "url": "https://www.tiktok.com/@carmscrolls/video/7692086305441991954", "vistas": 474900, "mercado": "Estados Unidos"}$j$::jsonb, now() - interval '7 minutes'),
  ('tt-7701096127067704589','marca-marketing',$j${"caption": "lemme be your social strategist for YOU🫵 whether you’re starting from day 1 or in your rebrand era, start with a control month. promise it’s way better than thinking of 17492639 ideas but never posting them", "comentarios": 756, "duracion": 113, "filtros": {"espanol": "duda", "repetible": "si", "tu_tema": "si", "ya_funciono": "duda"}, "formato": "“Déjame ser tu estratega”", "gancho_adaptado": "Déjame ser tu asesora por un minuto: si no sabes qué publicar, empieza por aquí.", "idioma": "en", "plataforma": "TikTok", "por_que_funciona": "Le habla a la persona como si fuera su asesora en una sesión y le da un plan simple para un mes. Las vistas no superan mucho a los seguidores, pero los 756 comentarios muestran que conecta.", "por_que_para_ti": "Es una muestra gratis de una asesoría 1:1: hablas como si estuvieras en sesión con ella, y al final la invitas a la de verdad.", "seguidores": 206000, "titulo": "Let me be your social strategist: start with a control month", "url": "https://www.tiktok.com/@inspiredmediaco/video/7701096127067704589", "vistas": 240200, "mercado": "Estados Unidos"}$j$::jsonb, now() - interval '8 minutes'),
  ('tt-7694153631527947541','marca-marketing',$j${"caption": "اگر میں کر سکتی ہوں آپ کیوں نہیں کر سکتیں؟ (Si yo pude, ¿por qué tú no?) #womeninbusiness #motivation", "comentarios": 1148, "duracion": 12, "filtros": {"espanol": "duda", "repetible": "si", "tu_tema": "si", "ya_funciono": "si"}, "formato": "Motivación en 12 segundos", "gancho_adaptado": "Empecé sin estudiar, con lo que tenía, y hoy vivo de mi emprendimiento. Si yo pude, ¿por qué tú no?", "idioma": "ur", "plataforma": "TikTok", "por_que_funciona": "Una sola frase directa en 12 segundos: se ve completo, se repite y desafía a quien lo ve. Tiene 52 veces sus seguidores y más de mil comentarios.", "por_que_para_ti": "Puedes contar tu historia real en una frase. Eso inspira a emprendedoras que creen que no pueden.", "seguidores": 4429, "titulo": "Si yo pude, ¿por qué tú no?", "url": "https://www.tiktok.com/@manager_falak/video/7694153631527947541", "vistas": 230200, "mercado": "Otro"}$j$::jsonb, now() - interval '9 minutes')
on conflict (id) do nothing;

-- Listo ✳
select 'CREATIVE.LAB lista ✳' as resultado;
