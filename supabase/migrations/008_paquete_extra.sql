-- Paquete extra de videos y periodos mensuales correctos al renovar antes de tiempo
alter table public.accesos add column if not exists extra integer not null default 0;
alter table public.accesos add column if not exists extra_periodo date;

-- Inicio del mes en curso: inicio + N meses (el último que ya empezó)
create or replace function public.periodo_de(i date) returns date
language sql stable as $$
  select case when i is null then null else
    (i + make_interval(months => greatest(0, (extract(year from age(current_date, i)) * 12 + extract(month from age(current_date, i)))::int)))::date end
$$;
grant execute on function public.periodo_de(date) to authenticated, service_role;

create or replace function public.mas_mes(d date) returns date
language sql immutable as $$ select (d + interval '1 month')::date $$;
grant execute on function public.mas_mes(date) to authenticated, service_role;

drop function if exists public.mi_plan();
create function public.mi_plan()
returns table (plan text, inicio date, fin date, periodo date, periodo_fin date, usados integer, extra integer, admin boolean)
language sql stable security definer set search_path = public as $$
  with a as (select *, public.periodo_de(inicio) as p from public.accesos where email = public.mi_email())
  select a.plan, a.inicio, a.fin, a.p, least(public.mas_mes(a.p), a.fin),
    (select count(*)::int from public.reestrenos r where r.user_id = auth.uid() and r.periodo = a.p),
    case when a.extra_periodo = a.p then a.extra else 0 end,
    public.es_admin()
  from a
$$;
grant execute on function public.mi_plan() to authenticated;
