// Logika murni (jarak, status, waktu) agar mudah diuji.
import { BEACHES, OLD_MS } from "./data.js";

const RAD = Math.PI / 180;
const EARTH_KM = 6371;

/** Jarak Haversine dalam km antara dua titik. */
export function distanceKm(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLng = (lng2 - lng1) * RAD;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * EARTH_KM * Math.asin(Math.sqrt(a));
}

/** Nama pantai terdekat dalam radius 4 km, di luar itu "Lainnya". */
export function nearestBeach(lat, lng, beaches = BEACHES) {
  let best = null;
  let bestDist = Infinity;
  for (const b of beaches) {
    const d = distanceKm(lat, lng, b.lat, b.lng);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  if (!best || bestDist > 4) return "Lainnya";
  return best.name;
}

/**
 * Status tiap pantai = rata-rata keparahan laporan 72 jam terakhir,
 * dibulatkan ke skala 1-4. Pantai tanpa laporan tidak masuk hasil.
 */
export function beachStatuses(reports, now = Date.now()) {
  const sums = new Map();
  for (const r of reports) {
    const t = new Date(r.takenAt).getTime();
    if (Number.isNaN(t) || now - t > OLD_MS || now - t < 0) continue;
    const sev = Number(r.severity);
    if (sev < 1 || sev > 4) continue;
    const agg = sums.get(r.beach) ?? { total: 0, count: 0 };
    agg.total += sev;
    agg.count += 1;
    sums.set(r.beach, agg);
  }
  const out = {};
  for (const [beach, agg] of sums) {
    out[beach] = Math.min(4, Math.max(1, Math.round(agg.total / agg.count)));
  }
  return out;
}

/**
 * Titik pusat tiap pantai = rata-rata lokasi laporan 72 jam terakhir yang valid
 * (filter sama persis dengan beachStatuses). Pantai preset memakai koordinat
 * resmi dari BEACHES; hasil ini dipakai untuk nama pantai non-preset
 * (mis. "Lainnya") agar heatmap tetap bisa digambar.
 */
export function beachCenters(reports, now = Date.now()) {
  const sums = new Map();
  for (const r of reports) {
    const t = new Date(r.takenAt).getTime();
    if (Number.isNaN(t) || now - t > OLD_MS || now - t < 0) continue;
    const sev = Number(r.severity);
    if (sev < 1 || sev > 4) continue;
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
    const agg = sums.get(r.beach) ?? { lat: 0, lng: 0, count: 0 };
    agg.lat += r.lat;
    agg.lng += r.lng;
    agg.count += 1;
    sums.set(r.beach, agg);
  }
  const out = {};
  for (const [beach, agg] of sums) {
    out[beach] = { lat: agg.lat / agg.count, lng: agg.lng / agg.count };
  }
  return out;
}

/** Waktu relatif Bahasa Indonesia, mis. "3 jam lalu". */
export function timeAgo(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "-";
  const diff = Math.max(0, now - t);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  return `${days} hari lalu`;
}

/** Format tanggal YYYY-MM-DD ke Bahasa Indonesia, mis. "12 Agustus 2026". */
export function fmtDate(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  if (!y || !m || !d) return String(dateStr);
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Makassar",
  }).format(date);
}

// ---------- helper foto (dipakai ReportForm, ProposeForm, ResultForm) ----------
// Tipe gambar yang diterima di semua form (sama dengan batas bucket storage).
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Validasi file gambar. Mengembalikan null bila valid, atau pesan error Bahasa Indonesia. */
export function validateImageFile(file) {
  if (!file) return "Lampirkan foto dulu.";
  if (!file.type || !ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return "File bukan gambar. Pilih file foto berformat JPG, PNG, atau WebP.";
  }
  return null;
}

/** Baca File gambar menjadi data URL (untuk pratinjau + penyimpanan mode demo). */
export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Foto tidak bisa dibaca."));
    reader.readAsDataURL(file);
  });
}
