-- Tambah kolom tipe & jumlah sampah; satukan laporan lama ke 'sampah'.
-- Jalankan via Supabase CLI (`supabase db push`) atau SQL Editor dashboard.

-- 1. Samakan data lama: laporan 'air' jadi 'sampah' (form kini khusus sampah pantai).
update public.reports set type = 'sampah' where type = 'air';

-- 2. Kolom baru (nullable dulu agar baris lama tidak gagal).
alter table public.reports
  add column if not exists waste_type text not null default 'mixed',
  add column if not exists waste_amount text not null default 'small';

-- 3. Validasi isi kolom baru.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reports_waste_type_allowed') then
    alter table public.reports
      add constraint reports_waste_type_allowed
      check (waste_type in ('plastic', 'fishing', 'food', 'oil', 'electronic', 'mixed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reports_waste_amount_allowed') then
    alter table public.reports
      add constraint reports_waste_amount_allowed
      check (waste_amount in ('small', 'medium', 'large'));
  end if;
end
$$;

-- 4. Kini type hanya 'sampah'. Ganti constraint lama agar insert 'air' ditolak.
alter table public.reports drop constraint if exists reports_type_allowed;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reports_type_allowed') then
    alter table public.reports
      add constraint reports_type_allowed check (type = 'sampah');
  end if;
end
$$;

-- 5. Policy insert anon: samakan dengan constraint baru.
drop policy if exists "reports_insert_anon" on public.reports;
create policy "reports_insert_anon" on public.reports
  for insert to anon, authenticated with check (
    severity between 1 and 4
    and type = 'sampah'
    and waste_type in ('plastic', 'fishing', 'food', 'oil', 'electronic', 'mixed')
    and waste_amount in ('small', 'medium', 'large')
    and source in ('exif', 'gps', 'peta')
    and char_length(beach) > 0
    and taken_at is not null
  );
