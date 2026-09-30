# Radar Pantai Bali — Beach Quality & Trash Radar

Web app crowdsourced untuk melaporkan kondisi pantai Bali, melihat peta kebersihan,
dan mengoordinasikan aksi clean-up. Seluruh teks antarmuka berbahasa Indonesia.

## Tech stack

- React 18 + Vite (JavaScript)
- Tailwind CSS v4 (plugin `@tailwindcss/vite`, tema di `@theme` dalam `src/index.css`)
- `leaflet` + `react-leaflet` v4 (tile OpenStreetMap)
- `exifr` (baca EXIF/geotag foto)
- Tanpa library UI / state management tambahan (hanya `useState`/`useMemo`)

## Cara install & menjalankan

```bash
npm install
npm run dev      # mode pengembangan
npm run build    # build produksi ke dist/
npm run preview  # pratinjau hasil build
```

Catatan: nama folder proyek mengandung karakter `&` yang memecah `npm run <script>`
di cmd Windows. Jika `npm run build` gagal dengan error `...\.bin\ is not recognized`,
jalankan Vite langsung (`node node_modules/vite/bin/vite.js build`) atau ganti nama
folder tanpa `&`/spasi (mis. `beach-quality-trash-radar`).

## Struktur folder

```
src/
  main.jsx        // import leaflet.css, font @fontsource, index.css
  index.css       // @import "tailwindcss"; @theme (warna, font)
  data.js         // BEACHES, SEVERITY, REPORT_TYPES, seed, OLD_MS
  utils.js        // distanceKm, nearestBeach, beachStatuses, timeAgo, fmtDate
  App.jsx         // state global, tab, header, toast
  MapView.jsx     // peta + heatmap + panel status pantai
  ReportForm.jsx  // formulir laporan (EXIF, GPS, peta mini)
  CleanupBoard.jsx// statistik + aksi mendatang/selesai + daftar aksi
DESIGN_NOTES.md   // rencana desain (ditulis sebelum UI)
PROJECT_BRIEF.md  // brief proyek
```

Data masih in-memory (hilang saat refresh). Tidak ada `localStorage`, API key, atau backend.

## Daftar TODO(backend)

- `src/data.js` — ganti seed dengan fetch API (laporan + aksi).
- `src/App.jsx` `handleSubmitReport` — POST laporan ke API, refresh dari server.
- `src/App.jsx` `handleJoin` — POST pendaftaran relawan ke API.
- `src/App.jsx` `handleRecordResult` — PUT hasil aksi ke API.
- `src/App.jsx` `handleCreateEvent` — POST aksi baru ke API.
- `src/ReportForm.jsx` `handleSubmit` — kirim laporan ke API, pakai respons server.

## Cara uji cepat

1. Tab **Peta**: 8 pantai terurut (Kuta Darurat di atas, Melasti/Padang Padang tanpa data
   di bawah). Klik pantai → peta terbang + 5 laporan terbaru. Klik titik laporan → popup.
2. Tab **Lapor**: unggah foto bergeotag → lokasi otomatis; atau "Pakai lokasi saya";
   atau ketuk peta mini. Pilih jenis + keparahan, kirim → pindah ke Peta + toast 4 detik.
3. Tab **Aksi clean-up**: "Gabung" menambah kuota (penuh → "Penuh" nonaktif),
   "Catat hasil" memindahkan aksi ke selesai dan menambah angka 465 kg.
