-- Respuestas de soporte como notificaciones dentro de la página
alter table public.soporte add column if not exists respuesta text;
alter table public.soporte add column if not exists respondida timestamptz;
alter table public.soporte add column if not exists vista boolean not null default true;

create or replace function public.marcar_vistas() returns void
language sql security definer set search_path = public as $$
  update public.soporte set vista = true where user_id = auth.uid() and vista = false;
$$;
grant execute on function public.marcar_vistas() to authenticated;
