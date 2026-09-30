# Catatan Desain — Radar Pantai Bali (Fase 1)

Ditulis sebelum UI, sebagai acuan Fase 2–5.

## 1. Palet
- Dasar: `tide #0b3b4a` (teks utama + header), `foam #e6f1ee` (latar aplikasi), putih untuk permukaan kartu/panel. Varian gelap header `tide-deep #082e3a` hanya untuk hover/fokus.
- Severity tetap sesuai brief, jangan diubah, selalu tampil bersama label teks (jangan andalkan warna saja):
  - 1 Bersih `#2f7d5b`
  - 2 Sampah ringan `#8db33a`
  - 3 Cukup parah `#e0a526`
  - 4 Darurat `#d1453b`
- Dilarang: krem/terakota, gradien ungu/biru, teks abu-abu di atas latar berwarna. Kontras target WCAG AA (teks body 4.5:1, teks besar 3:1).

## 2. Tipografi
- Display: Bricolage Grotesque (600/700) untuk nama aplikasi dan judul panel. Body: Source Sans 3 (400/600/700) untuk semua teks UI.
- Alasan: Bricolage memberi karakter lapangan yang tegas dan mudah dibaca di cahaya terik; Source Sans 3 netral dan rapat untuk daftar status yang padat. Keduanya self-host via `@fontsource`, tanpa `<link>` Google Fonts.
- Bukan Inter default. Ukuran judul halaman `text-xl md:text-2xl`, judul panel `text-base font-bold`, body `text-sm md:text-base`.

## 3. Konsep layout
- Satu elemen menonjol: peta + daftar status pantai. Sisanya tenang dan disiplin.
- Header ramping 64–72px, satu baris di desktop: nama aplikasi + tab. Di mobile: header lalu tab bar full-width di bawahnya.
- Tab memakai `role="tablist"` + `role="tab"` + `aria-selected`/`aria-current="page"` pada tab aktif. Target sentuh min 44px.
- Konten `max-w-7xl mx-auto px-4`, grid `lg:grid-cols-[1fr_360px]` untuk peta + panel samping di Fase 2. Di bawah `lg`, single-column: peta dulu, daftar status sesudahnya.
- Permukaan: `bg-white border border-tide/10 rounded-2xl` untuk panel. Larangan: tidak ada kartu bersarang di dalam kartu, tidak ada ikon besar di atas tiap judul, tidak ada label kecil kapital di atas tiap heading, tidak ada penomoran dekoratif.
- Bahasa Indonesia, kalimat biasa, kata kerja aktif ("Kirim laporan", "Gabung", "Simpan hasil").

## 4. Posisi tiga dial (skill design-taste-frontend, dikalibrasi untuk alat peta)
- VARIANCE rendah-sedang (~4/10): layout simetris mudah dipindai, peta kiri + daftar kanan. Tanpa hero marketing, testimoni, atau blok promosi.
- MOTION rendah (~2/10): gerak hanya sebagai respons aksi — peta `flyTo` saat lokasi EXIF/GPS/peta dipilih, toast konfirmasi 4 detik. Tanpa animasi masuk per section, tanpa efek scroll dekoratif.
- DENSITY sedang-tinggi (~6–7/10): status 8 pantai terlihat sekilas tanpa banyak scroll; angka memakai font tebal, bukan hiasan.
- Aksesibilitas: `aria-pressed` di tombol pilihan severity, `role="progressbar"` di kuota aksi, semua gerak runtuh di `prefers-reduced-motion`.

## 5. Yang diubah dari default Vite + Tailwind
- Hapus template Vite (hero, counter, `App.css`, CSS bawaan ungu) → ganti `index.css` minimal: `@import "tailwindcss"` + `@theme` + reset body + fokus terlihat.
- Tambah plugin `@tailwindcss/vite` di `vite.config.js`; tanpa `postcss.config.js`.
- `main.jsx` mengimpor `leaflet/dist/leaflet.css` lebih dulu, lalu font `@fontsource`, lalu `index.css`.
- `index.html`: `lang="id"`, judul "Radar Pantai Bali — Kualitas & Sampah".
- Downgrade React 19 bawaan scaffold ke React 18 sesuai brief. Dependensi terkunci: `leaflet`, `react-leaflet@^4`, `exifr`, tanpa UI lib / state management tambahan.
