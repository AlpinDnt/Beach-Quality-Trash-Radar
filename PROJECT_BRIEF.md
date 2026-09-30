# Radar Pantai Bali (Beach Quality & Trash Radar)

## Konteks
Bali punya garis pantai panjang yang sering terdampak sampah laut musiman dan polusi air di area wisata padat (Kuta, Seminyak, Canggu, Sanur, dll). Bangun web app crowdsourced di mana pengunjung dan pegiat lingkungan melaporkan kondisi pantai, melihat peta kebersihan secara real-time, dan mengoordinasikan aksi clean-up. Ini mini project: buat sederhana, rapi, dan mudah dikembangkan.

## Tech stack (wajib)
- React 18 + Vite (JavaScript, bukan TypeScript)
- Tailwind CSS v4 (plugin `@tailwindcss/vite`, tema lewat `@theme` di `src/index.css`)
- `leaflet` + `react-leaflet` v4 (tile OpenStreetMap)
- `exifr` untuk membaca EXIF/geotag dari foto
- Tanpa library UI atau state management tambahan. Cukup `useState`/`useMemo`.
- Semua teks antarmuka dalam Bahasa Indonesia.

## Fitur

### 1. Peta + Heatmap Kebersihan (tab "Peta")
- Peta Bali (pusat sekitar -8.72, 115.17, zoom 11).
- Minimal 8 pantai preset: Kuta (-8.7184, 115.1686), Seminyak (-8.6913, 115.1583), Canggu (-8.6512, 115.13), Sanur (-8.69, 115.262), Jimbaran (-8.79, 115.165), Nusa Dua (-8.8, 115.232), Melasti (-8.8497, 115.124), Padang Padang (-8.815, 115.103).
- Status pantai = rata-rata keparahan laporan 72 jam terakhir, dibulatkan ke skala 1-4:
  1 Bersih (#2f7d5b), 2 Sampah ringan (#8db33a), 3 Cukup parah (#e0a526), 4 Darurat (#d1453b).
- Heatmap: lingkaran berlapis (radius 1800m, 1000m, 450m dengan opacity berbeda) di tiap pantai, warna sesuai status. Pantai tanpa laporan tidak digambar.
- Setiap laporan tampil sebagai `CircleMarker` berwarna sesuai keparahan. Popup berisi nama pantai, jenis, waktu ("3 jam lalu"), foto, catatan. Gunakan `CircleMarker`, bukan `Marker` (hindari masalah ikon default Leaflet di Vite).
- Panel samping: pantai diurutkan dari paling darurat ke paling bersih (tanpa data di paling bawah). Klik pantai untuk memilihnya dan menampilkan 5 laporan terbarunya. Jika belum ada laporan, tampilkan tautan "Jadi yang pertama".

### 2. Laporan crowdsourced (tab "Lapor")
- Unggah foto (`accept="image/*"`) dengan pratinjau.
- Setelah foto dipilih, baca EXIF: `exifr.gps(file)` dan `exifr.parse(file, ["DateTimeOriginal"])`.
  - Ada GPS: isi lokasi otomatis, sumber "exif", peta form terbang (flyTo) ke titik itu.
  - `DateTimeOriginal` dipakai sebagai `takenAt`.
  - Tidak ada GPS atau gagal dibaca: tampilkan pesan yang menjelaskan cara memperbaikinya.
- Alternatif lokasi: tombol "Pakai lokasi saya" (`navigator.geolocation`, sumber "gps") dan klik di peta mini (sumber "peta").
- Nama pantai otomatis dari pantai terdekat (Haversine, maksimal 4 km, di luar itu "Lainnya").
- Jenis laporan: "Sampah pantai" atau "Kualitas air laut".
- Keparahan 1-4 berupa tombol pilihan dengan warna, label, dan petunjuk singkat.
- Catatan opsional. Validasi: lokasi wajib terisi.
- Setelah submit: laporan langsung muncul di peta, pindah ke tab "Peta", pantai terkait terpilih, toast konfirmasi hilang sendiri setelah 4 detik.

### 3. Aksi clean-up (tab "Aksi clean-up")
- Statistik di atas: total kg sampah terangkut, jumlah aksi selesai, jumlah relawan.
- "Aksi mendatang" (urut tanggal): judul, pantai, tanggal (format Indonesia), penyelenggara, progress kuota (`role="progressbar"`), tombol "Gabung" (nonaktif dan berlabel "Penuh" jika kuota habis), tombol "Catat hasil".
- "Catat hasil" membuka form inline: kg sampah dan relawan hadir. Saat disimpan, status menjadi "done" dan angkanya masuk statistik.
- "Sudah selesai": judul, pantai, tanggal, kg, relawan.
- Form "Daftarkan aksi": nama aksi, pantai (dropdown), tanggal, penyelenggara, kuota relawan.

## Model data
```js
Report = { id, beach, lat, lng, severity: 1|2|3|4, type: "sampah"|"air",
           note, photo, takenAt: ISO string, source: "exif"|"gps"|"peta" }
Event  = { id, title, beach, date: "YYYY-MM-DD", organizer, slots, joined,
           status: "upcoming"|"done", kg?, volunteers? }
```
Seed data realistis di `src/data.js`: 7 laporan (waktu relatif terhadap sekarang), 4 aksi (2 mendatang, 2 selesai).

## Struktur file
```
src/
  main.jsx        // import leaflet/dist/leaflet.css dan index.css
  index.css       // @import "tailwindcss"; @theme (warna, font)
  data.js         // BEACHES, SEVERITY, REPORT_TYPES, seed data, OLD_MS
  utils.js        // distanceKm, nearestBeach, beachStatuses, timeAgo, fmtDate
  App.jsx         // state global, tab, header, toast
  MapView.jsx
  ReportForm.jsx
  CleanupBoard.jsx
```
Logika murni (status, jarak) di `utils.js` agar mudah diuji.

## Arahan desain (pakai skill design-taste-frontend)
Skill ini dirancang untuk landing page, jadi terapkan hanya prinsip yang cocok untuk alat berbasis peta. Jangan menambah hero marketing, testimoni, atau blok promosi.

Kalibrasi dial:
- VARIANCE: rendah-sedang. Layout mudah dipindai, peta dan daftar status jadi pusat.
- MOTION: rendah. Gerak hanya sebagai respons aksi (konfirmasi kirim laporan, peta terbang ke lokasi). Tanpa animasi masuk di tiap section, tanpa efek scroll dekoratif.
- DENSITY: sedang-tinggi. Status pantai terlihat sekilas tanpa banyak scroll.

Konteks desain:
- Pengguna: wisatawan yang mengecek pantai sebelum berkunjung, relawan dan pegiat lingkungan, penyelenggara komunitas.
- Tugas utama: kurang dari 10 detik untuk tahu pantai mana yang bersih atau darurat, dan melapor lewat HP di lokasi dengan sedikit ketukan.
- Nuansa: tenang, informatif, terpercaya, seperti alat lapangan. Bukan brosur wisata atau dashboard SaaS.
- Warna severity tetap (jangan diubah) dan konsisten di peta, daftar, tombol, popup, selalu dengan label teks.
- Tema dasar: tide #0b3b4a (teks dan header), foam #e6f1ee (latar), putih untuk permukaan. Hindari krem/terakota dan gradien ungu.
- Utamakan mobile: satu tangan, cahaya terik (kontras tinggi, target sentuh besar).
- Teks UI: kalimat biasa, kata kerja aktif ("Kirim laporan", "Gabung", "Simpan hasil"). Pesan error menjelaskan cara memperbaiki.

Larangan (anti-slop):
- Tidak ada kartu bersarang di dalam kartu, ikon besar di atas setiap judul, gradien dekoratif, teks abu-abu di atas latar berwarna.
- Tidak ada label kecil huruf kapital di atas tiap heading, tidak ada penomoran dekoratif untuk konten yang bukan urutan.
- Jangan default ke Inter. Pilih font sesuai karakter proyek (Bricolage Grotesque + Source Sans 3 boleh dipertahankan bila hasil evaluasi cocok).
- Satu elemen yang menonjol (usulan: peta dan status pantai). Sisanya tenang dan disiplin.
- Kualitas dasar: responsif sampai mobile, fokus keyboard terlihat, `aria-pressed` di tombol pilihan, `aria-current` di tab aktif, `prefers-reduced-motion` dihormati, jangan andalkan warna saja.

## Fase pengerjaan
1. Fase 1: scaffold, Tailwind, `data.js`, `utils.js`, layout `App.jsx` dengan tab kosong, rencana desain.
2. Fase 2: `MapView` + panel status pantai.
3. Fase 3: `ReportForm` (EXIF, GPS, pemilih lokasi di peta).
4. Fase 4: `CleanupBoard`.
5. Fase 5: audit anti-slop, responsif, aksesibilitas, README.

## Kriteria selesai
- `npm install && npm run build` berhasil tanpa error atau warning penting.
- Alur utama berjalan: unggah foto bergeotag, lokasi terisi otomatis, kirim laporan, heatmap pantai itu berubah warna.
- Aksi clean-up bisa dibuat, diikuti relawan, dan dicatat hasilnya, statistik ikut berubah.
- Tidak ada `localStorage`, API key, atau backend (data in-memory dulu).
- Tidak ada dependency di luar tech stack tanpa persetujuan saya.

## Di luar cakupan (jangan dikerjakan dulu)
Autentikasi, backend/database, upload foto ke server, notifikasi, multi-bahasa. Beri komentar `// TODO(backend):` di titik yang nanti perlu API (submit laporan, gabung aksi, simpan hasil).