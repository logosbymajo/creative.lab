-- Fotos de perfil
insert into storage.buckets (id, name, public) values ('avatares','avatares',true)
on conflict (id) do update set public = true;

drop policy if exists "avatar ver" on storage.objects;
create policy "avatar ver" on storage.objects for select using (bucket_id = 'avatares');
drop policy if exists "avatar subir" on storage.objects;
create policy "avatar subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatares' and name = auth.uid()::text || '.jpg');
drop policy if exists "avatar cambiar" on storage.objects;
create policy "avatar cambiar" on storage.objects for update to authenticated
  using (bucket_id = 'avatares' and name = auth.uid()::text || '.jpg')
  with check (bucket_id = 'avatares' and name = auth.uid()::text || '.jpg');
drop policy if exists "avatar borrar" on storage.objects;
create policy "avatar borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatares' and name = auth.uid()::text || '.jpg');
