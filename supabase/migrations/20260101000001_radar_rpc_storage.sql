-- Radar Pantai Bali: RPC kuota/hasil + bucket foto.
-- Bergantung pada 20260101000000_radar_init.sql (tabel + pgcrypto).

-- Gabung aksi: naikkan joined hanya bila status upcoming dan kuota tersisa.
-- Atomic (satu UPDATE) sehingga aman dari race antar klien.
create or replace function public.join_event(p_event_id uuid)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events;
begin
  update public.events
  set joined = joined + 1
  where id = p_event_id
    and status = 'upcoming'
    and joined < slots
  returning * into v_event;

  if not found then
    raise exception 'EVENT_FULL';
  end if;

  return v_event;
end;
$$;

revoke all on function public.join_event(uuid) from public;
grant execute on function public.join_event(uuid) to anon, authenticated;

-- Catat hasil: verifikasi kode rahasia penyelenggara terhadap hash SHA-256 hex,
-- lalu ubah status menjadi done beserta angka kg dan relawan.
create or replace function public.finish_event(
  p_event_id uuid,
  p_secret text,
  p_kg numeric,
  p_volunteers integer
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events;
begin
  if p_kg is null or p_kg <= 0 then
    raise exception 'INVALID_KG';
  end if;

  if p_volunteers is null or p_volunteers < 1 then
    raise exception 'INVALID_VOLUNTEERS';
  end if;

  select * into v_event from public.events where id = p_event_id;

  if not found then
    raise exception 'EVENT_NOT_FOUND';
  end if;

  if v_event.status <> 'upcoming' then
    raise exception 'EVENT_ALREADY_DONE';
  end if;

  if v_event.organizer_secret_hash is null
    or encode(digest(p_secret, 'sha256'), 'hex') <> v_event.organizer_secret_hash then
    raise exception 'INVALID_SECRET';
  end if;

  update public.events
  set status = 'done', kg = p_kg, volunteers = p_volunteers
  where id = p_event_id
  returning * into v_event;

  return v_event;
end;
$$;

revoke all on function public.finish_event(uuid, text, numeric, integer) from public;
grant execute on function public.finish_event(uuid, text, numeric, integer) to anon, authenticated;

-- Bucket foto laporan: baca publik, upload anon dibatasi tipe + 5 MB.
-- Batas tipe/ukuran ditegakkan native oleh bucket (allowed_mime_types, file_size_limit).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'report-photos',
  'report-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "report-photos_select_public" on storage.objects;
create policy "report-photos_select_public" on storage.objects
  for select to anon, authenticated using (bucket_id = 'report-photos');

drop policy if exists "report-photos_insert_anon" on storage.objects;
create policy "report-photos_insert_anon" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'report-photos');

-- Sengaja TIDAK ada policy update/delete objek: foto tidak bisa diubah/dihapus client.
