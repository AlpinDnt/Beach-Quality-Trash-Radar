-- Radar Pantai Bali: tabel + RLS + realtime.
-- Jalankan via Supabase CLI (`supabase db push`) atau SQL Editor dashboard.

create extension if not exists "pgcrypto";

-- Titik acuan anti-spam: pusat Bali (-8.72, 115.17), radius 15 km.
-- Jarak Haversine dalam km; dipakai constraint tabel reports.

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  beach text not null,
  lat double precision not null,
  lng double precision not null,
  severity smallint not null,
  type text not null,
  note text not null default '',
  photo_url text not null default '',
  taken_at timestamptz not null,
  source text not null,
  created_at timestamptz not null default now(),
  constraint reports_severity_range check (severity between 1 and 4),
  constraint reports_type_allowed check (type in ('sampah', 'air')),
  constraint reports_source_allowed check (source in ('exif', 'gps', 'peta')),
  constraint reports_beach_present check (char_length(beach) > 0),
  constraint reports_within_bali check (
    6371 * 2 * asin(sqrt(least(1.0,
      power(sin(radians(lat + 8.72) / 2), 2) +
      cos(radians(-8.72)) * cos(radians(lat)) *
      power(sin(radians(lng - 115.17) / 2), 2)
    ))) <= 15
  )
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  beach text not null,
  date date not null,
  organizer text not null,
  slots integer not null,
  joined integer not null default 0,
  status text not null default 'upcoming',
  kg numeric,
  volunteers integer,
  organizer_secret_hash text not null,
  created_at timestamptz not null default now(),
  constraint events_title_present check (char_length(title) > 0),
  constraint events_organizer_present check (char_length(organizer) > 0),
  constraint events_slots_positive check (slots > 0),
  constraint events_joined_sane check (joined >= 0),
  constraint events_status_allowed check (status in ('upcoming', 'done'))
);

alter table public.reports enable row level security;
alter table public.events enable row level security;

-- Baca publik (tanpa login).
drop policy if exists "reports_select_public" on public.reports;
create policy "reports_select_public" on public.reports
  for select to anon, authenticated using (true);

drop policy if exists "events_select_public" on public.events;
create policy "events_select_public" on public.events
  for select to anon, authenticated using (true);

-- Insert laporan oleh anon, dengan validasi kolom di policy
-- (CHECK constraint di atas menegakkannya sekali lagi di level tabel).
drop policy if exists "reports_insert_anon" on public.reports;
create policy "reports_insert_anon" on public.reports
  for insert to anon, authenticated with check (
    severity between 1 and 4
    and type in ('sampah', 'air')
    and source in ('exif', 'gps', 'peta')
    and char_length(beach) > 0
    and taken_at is not null
  );

-- Insert aksi oleh anon. Kolom joined/status default dari skema;
-- policy memastikan baris baru selalu dimulai sebagai upcoming kosong.
drop policy if exists "events_insert_anon" on public.events;
create policy "events_insert_anon" on public.events
  for insert to anon, authenticated with check (
    char_length(title) > 0
    and char_length(organizer) > 0
    and slots > 0
    and joined = 0
    and status = 'upcoming'
    and date is not null
    and organizer_secret_hash is not null
  );

-- Sengaja TIDAK ada policy update/delete: client tidak boleh ubah/hapus langsung.
-- Perubahan kuota dan penyelesaian aksi hanya lewat RPC security definer.

-- Realtime: insert reports disiarkan ke subscriber.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'reports'
  ) then
    alter publication supabase_realtime add table public.reports;
  end if;
end
$$;
