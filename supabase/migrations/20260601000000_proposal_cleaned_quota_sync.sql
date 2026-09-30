-- Sinkronisasi kehadiran dengan pendaftaran + titik dibersihkan di usulan hasil.
-- Bergantung pada 20260401000000_finish_event_admin_quota.sql dan
-- 20260501000000_result_proposals.sql.
--
-- Perubahan:
-- 1. Kolom baru result_proposals.cleaned_ids (uuid[]): titik laporan yang
--    dicentang relawan di form Lapor hasil ("Tanda yang dibersihkan" pindah
--    dari form Catat hasil admin ke form usulan relawan).
-- 2. RPC finish_event: relawan hadir (p_volunteers) juga tidak boleh melebihi
--    jumlah yang terdaftar (joined), selain batas kuota yang sudah ada
--    (raise VOLUNTEERS_OVER_JOINED). Contoh: terdaftar 10 maka hadir 11
--    ditolak walaupun kuota 16.

alter table public.result_proposals
  add column if not exists cleaned_ids uuid[] not null default '{}';

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

  if p_volunteers > v_event.joined then
    raise exception 'VOLUNTEERS_OVER_JOINED';
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
