-- Mensajes a todas (campanita) y cuáles ya vio cada usuaria
create table if not exists public.avisos (
  id     uuid primary key default gen_random_uuid(),
  titulo text not null,
  texto  text not null,
  boton  text,
  link   text,
  creado timestamptz not null default now()
);
alter table public.avisos enable row level security;
drop policy if exists "ver avisos" on public.avisos;
create policy "ver avisos" on public.avisos for select to authenticated using (public.tiene_acceso() or public.es_admin());
drop policy if exists "admin crea avisos" on public.avisos;
create policy "admin crea avisos" on public.avisos for insert to authenticated with check (public.es_admin());
drop policy if exists "admin borra avisos" on public.avisos;
create policy "admin borra avisos" on public.avisos for delete to authenticated using (public.es_admin());

create table if not exists public.avisos_vistos (
  user_id  uuid not null references auth.users on delete cascade default auth.uid(),
  aviso_id uuid not null references public.avisos on delete cascade,
  primary key (user_id, aviso_id)
);
alter table public.avisos_vistos enable row level security;
drop policy if exists "mis vistos" on public.avisos_vistos;
create policy "mis vistos" on public.avisos_vistos for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
