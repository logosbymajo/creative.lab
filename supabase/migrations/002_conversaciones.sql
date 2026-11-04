-- Conversaciones con la Mentora (cada persona ve solo las suyas)
create table if not exists public.conversaciones (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade default auth.uid(),
  titulo      text,
  mensajes    jsonb not null default '[]'::jsonb,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index if not exists conversaciones_user on public.conversaciones (user_id, actualizado desc);
alter table public.conversaciones enable row level security;
drop policy if exists "mis conversaciones" on public.conversaciones;
create policy "mis conversaciones" on public.conversaciones for all to authenticated
  using (user_id = auth.uid() and public.tiene_acceso())
  with check (user_id = auth.uid() and public.tiene_acceso());
