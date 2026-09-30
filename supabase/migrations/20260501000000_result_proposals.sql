-- Usulan hasil lapangan: angka dari relawan (kg, hadir, foto, catatan) per aksi.
-- Jalankan via Supabase CLI (`supabase db push`) atau SQL Editor dashboard.
-- Bergantung pada 20260101000000_radar_init.sql dan 20260301000000_event_moderation.sql.
--
-- Alur:
-- - Siapa pun (anon) boleh MENGUSULKAN angka hasil untuk aksi 'upcoming'.
--   Angka mentah TIDAK mengubah statistik sebelum disahkan admin.
-- - Hanya admin yang bisa MEMBACA antrean dan MENERIMA/MENOLAK usulan
--   lewat RPC resolve_proposal -> 'accepted' / 'rejected'.
-- - Pengesahan menjadi hasil resmi tetap lewat finish_event (wajib admin,
--   batas hadir <= kuota, lihat 20260401000000_finish_event_admin_quota.sql)
--   yang dipanggil client dengan angka usulan yang disahkan.

create table if not exists public.result_proposals (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  kg numeric not null,
  volunteers integer not null,
  photo_url text not null default '',
  note text not null default '',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint result_proposals_kg_positive check (kg > 0),
  constraint result_proposals_volunteers_positive check (volunteers >= 1),
  constraint result_proposals_status_allowed check (status in ('pending', 'accepted', 'rejected'))
);

alter table public.result_proposals enable row level security;

-- Baca publik: SENGAJA tidak ada — angka mentah bukan fakta resmi dan tidak
-- boleh tampil sebelum diverifikasi admin (mencegah klaim palsu beredar).
-- Tulis usulan oleh anon, dengan validasi kolom di policy
-- (CHECK constraint di atas menegakkannya sekali lagi di level tabel).
-- Batas hadir <= kuota dicek di aplikasi + saat pengesahan (finish_event),
-- karena slots hidup di tabel events (bukan di baris usulan ini).
drop policy if exists "result_proposals_insert_anon" on public.result_proposals;
create policy "result_proposals_insert_anon" on public.result_proposals
  for insert to anon, authenticated with check (
    kg > 0
    and volunteers >= 1
    and status = 'pending'
    and event_id is not null
  );

-- Admin (login + terdaftar di public.admins) boleh membaca semua usulan.
drop policy if exists "result_proposals_select_admin" on public.result_proposals;
create policy "result_proposals_select_admin" on public.result_proposals
  for select to authenticated using (public.is_admin());

-- Terima/tolak usulan lewat RPC agar atomik dan hanya bisa oleh admin.
-- Sengaja TIDAK ada policy update/delete langsung dari client.
create or replace function public.resolve_proposal(
  p_proposal_id uuid,
  p_accept boolean
)
returns public.result_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.result_proposals;
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;

  select * into v_proposal from public.result_proposals where id = p_proposal_id;

  if not found then
    raise exception 'PROPOSAL_NOT_FOUND';
  end if;

  if v_proposal.status <> 'pending' then
    raise exception 'PROPOSAL_NOT_PENDING';
  end if;

  update public.result_proposals
  set status = case when p_accept then 'accepted' else 'rejected' end
  where id = p_proposal_id
  returning * into v_proposal;

  return v_proposal;
end;
$$;

revoke all on function public.resolve_proposal(uuid, boolean) from public;
grant execute on function public.resolve_proposal(uuid, boolean) to authenticated;
