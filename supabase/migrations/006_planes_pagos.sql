-- Planes, mensualidad y pagos con Wompi
alter table public.accesos add column if not exists plan text;          -- basico | pro | premium | null (cortesía)
alter table public.accesos add column if not exists inicio date;
alter table public.accesos add column if not exists fin date;

create table if not exists public.reestrenos (
  user_id uuid not null references auth.users on delete cascade,
  url     text not null,
  periodo date not null,
  creado  timestamptz not null default now(),
  primary key (user_id, url, periodo)
);
alter table public.reestrenos enable row level security;
drop policy if exists "mis reestrenos" on public.reestrenos;
create policy "mis reestrenos" on public.reestrenos for select to authenticated using (user_id = auth.uid() or public.es_admin());

create table if not exists public.pagos (
  referencia text primary key,
  email      text not null,
  plan       text not null,
  monto      integer not null,
  estado     text not null default 'pendiente',
  wompi_id   text,
  creado     timestamptz not null default now(),
  aplicado   timestamptz
);
alter table public.pagos enable row level security;
drop policy if exists "mis pagos" on public.pagos;
create policy "mis pagos" on public.pagos for select to authenticated using (email = public.mi_email() or public.es_admin());

create or replace function public.mi_plan()
returns table (plan text, inicio date, fin date, usados integer, admin boolean)
language sql stable security definer set search_path = public as $$
  select a.plan, a.inicio, a.fin,
    (select count(*)::int from public.reestrenos r where r.user_id = auth.uid() and a.inicio is not null and r.periodo = a.inicio),
    public.es_admin()
  from public.accesos a where a.email = public.mi_email()
$$;
grant execute on function public.mi_plan() to authenticated;
