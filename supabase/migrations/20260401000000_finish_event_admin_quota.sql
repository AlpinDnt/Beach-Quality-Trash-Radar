-- Pencatatan hasil aksi: khusus admin + batas kuota.
-- Bergantung pada 20260101000001_radar_rpc_storage.sql (fungsi awal) dan
-- 20260301000000_event_moderation.sql (tabel public.admins + is_admin()).
--
-- Perubahan dari versi awal:
-- 1. Wajib admin: hanya penelepon yang terdaftar di public.admins yang bisa
--    mencatat hasil (raise NOT_ADMIN). Verifikasi kode rahasia penyelenggara
--    tidak lagi diwajibkan karena admin tidak memegang kode tersebut;
--    parameter p_secret tetap ada agar signature RPC tidak berubah.
-- 2. Batas tegas: relawan hadir (p_volunteers) tidak boleh melebihi kuota
--    aksi (slots), sesuai aturan "hadir <= kuota" (raise VOLUNTEERS_OVER_QUOTA).
--    Contoh: kuota 16 maka hadir 17 ditolak.

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
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;

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

  if v_event.slots > 0 and p_volunteers > v_event.slots then
    raise exception 'VOLUNTEERS_OVER_QUOTA';
  end if;

  update public.events
  set status = 'done', kg = p_kg, volunteers = p_volunteers
  where id = p_event_id
  returning * into v_event;

  return v_event;
end;
$$;

revoke all on function public.finish_event(uuid, text, numeric, integer) from public;
grant execute on function public.finish_event(uuid, text, numeric, integer) to authenticated;
