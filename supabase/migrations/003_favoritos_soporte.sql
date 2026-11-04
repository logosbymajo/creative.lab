-- Videos guardados del radar
create table if not exists public.favoritos (
  user_id  uuid not null references auth.users on delete cascade default auth.uid(),
  video_id text not null,
  creado   timestamptz not null default now(),
  primary key (user_id, video_id)
);
alter table public.favoritos enable row level security;
drop policy if exists "mis favoritos" on public.favoritos;
create policy "mis favoritos" on public.favoritos for all to authenticated
  using (user_id = auth.uid() and public.tiene_acceso())
  with check (user_id = auth.uid() and public.tiene_acceso());

-- Solicitudes de soporte
create table if not exists public.soporte (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid references auth.users on delete set null default auth.uid(),
  email    text default public.mi_email(),
  tipo     text,
  mensaje  text not null,
  estado   text not null default 'abierta',
  creado   timestamptz not null default now()
);
alter table public.soporte enable row level security;
drop policy if exists "creo mis solicitudes" on public.soporte;
create policy "creo mis solicitudes" on public.soporte for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "veo mis solicitudes" on public.soporte;
create policy "veo mis solicitudes" on public.soporte for select to authenticated using (user_id = auth.uid() or public.es_admin());
drop policy if exists "admin actualiza soporte" on public.soporte;
create policy "admin actualiza soporte" on public.soporte for update to authenticated using (public.es_admin()) with check (public.es_admin());
