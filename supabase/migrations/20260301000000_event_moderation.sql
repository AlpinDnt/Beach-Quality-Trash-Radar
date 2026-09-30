-- Moderasi aksi clean-up: usulan publik (pending) + persetujuan admin.
-- Jalankan via Supabase CLI (`supabase db push`) atau SQL Editor dashboard.
-- Bergantung pada 20260101000000_radar_init.sql dan 20260101000001_radar_rpc_storage.sql.
--
-- Alur baru:
-- - Anon TETAP boleh mengusulkan aksi, tapi baris baru WAJIB status='pending'
--   sehingga tidak langsung tampil di publik.
-- - Hanya admin (terdaftar di public.admins) yang bisa menyetujui/menolak
--   lewat RPC approve_event -> 'upcoming' / 'rejected'.
-- - Publik hanya bisa membaca status 'upcoming'/'done'.
--
-- Cara jadikan seseorang admin (di SQL Editor, setelah user login sekali
-- via Supabase Auth sehingga ada di auth.users):
--   insert into public.admins (user_id) values ('<uuid-user>');
--   Lihat uuid-nya di Dashboard > Authentication > Users.

-- 1. Daftar admin + helper pengecekan.
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- Tidak ada akses client langsung ke tabel admins; dibaca hanya dari RPC
-- security definer (is_admin / approve_event) di bawah.
drop policy if exists "admins_none" on public.admins;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins where user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- 2. Status baru: 'pending' (usulan menunggu) dan 'rejected' (ditolak).
alter table public.events drop constraint if exists events_status_allowed;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_status_allowed') then
    alter table public.events
      add constraint events_status_allowed
      check (status in ('pending', 'upcoming', 'done', 'rejected'));
  end if;
end
$$;

-- 3. Anon hanya boleh INSERT usulan (status pending, belum ada peserta).
drop policy if exists "events_insert_anon" on public.events;
create policy "events_insert_anon" on public.events
  for insert to anon, authenticated with check (
    char_length(title) > 0
    and char_length(organizer) > 0
    and slots > 0
    and joined = 0
    and status = 'pending'
    and date is not null
    and organizer_secret_hash is not null
  );

-- 4. Baca publik: hanya aksi yang sudah disetujui/selesai.
drop policy if exists "events_select_public" on public.events;
create policy "events_select_public" on public.events
  for select to anon, authenticated using (status in ('upcoming', 'done'));

-- Admin (login + terdaftar di public.admins) boleh membaca semua,
-- termasuk antrean 'pending' dan yang 'rejected'.
drop policy if exists "events_select_admin" on public.events;
create policy "events_select_admin" on public.events
  for select to authenticated using (public.is_admin());

-- 5. Persetujuan admin lewat RPC agar atomik dan tidak bisa dipalsukan client.
-- join_event / finish_event yang sudah ada tidak berubah: keduanya hanya
-- bekerja pada status 'upcoming', sehingga usulan pending tidak bisa
-- diikuti atau diselesaikan sebelum disetujui.
create or replace function public.approve_event(
  p_event_id uuid,
  p_approve boolean
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

  select * into v_event from public.events where id = p_event_id;

  if not found then
    raise exception 'EVENT_NOT_FOUND';
  end if;

  if v_event.status <> 'pending' then
    raise exception 'EVENT_NOT_PENDING';
  end if;

  update public.events
  set status = case when p_approve then 'upcoming' else 'rejected' end
  where id = p_event_id
  returning * into v_event;

  return v_event;
end;
$$;

revoke all on function public.approve_event(uuid, boolean) from public;
grant execute on function public.approve_event(uuid, boolean) to authenticated;

-- Sengaja tetap TIDAK ada policy update/delete langsung:
-- perubahan status hanya lewat approve_event, kuota lewat join_event,
-- penyelesaian lewat finish_event.
