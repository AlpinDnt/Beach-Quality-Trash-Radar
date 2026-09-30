// Satu-satunya lapisan data. Komponen hanya memanggil fungsi di file ini,
// tidak pernah mengimpor supabase client atau seed secara langsung.
//
// Dua mode:
// - Supabase terkonfigurasi (env terisi): baca/tulis ke database + storage.
// - Mode demo (env kosong): operasi yang sama di atas salinan seed in-memory,
//   sehingga UI tidak perlu jalur kode ganda. Data demo hilang saat refresh.
//
// Foto: koordinat dan waktu baca dari file ASLI di form (EXIF) SEBELUM file
// sampai ke sini, karena kompresi canvas di bawah menghapus EXIF.

import { supabase, isSupabaseConfigured } from "./supabase.js";
import { SEED_EVENTS, SEED_PROPOSALS, SEED_REPORTS } from "./data.js";
import { distanceKm } from "./utils.js";

const BALI_CENTER = { lat: -8.72, lng: 115.17 };
const MAX_KM = 15;
const PHOTO_BUCKET = "report-photos";
const PHOTO_MAX_SIDE = 1600;
const PHOTO_QUALITY = 0.82;

// ---------- mode demo (in-memory) ----------

let demoReports = null;
let demoEvents = null; // menyimpan organizer_secret_hash internal (tak diekspos)
let demoProposals = null; // usulan hasil lapangan (tak tampil publik sebelum disahkan)
let demoSeq = 0;

function demoStore() {
  if (!demoReports) {
    demoReports = SEED_REPORTS.map((r) => ({ ...r }));
    demoEvents = SEED_EVENTS.map((e) => ({ ...e, organizer_secret_hash: "demo" }));
  }
  return { demoReports, demoEvents };
}

// ---------- anti-spam klien: maks 5 laporan/jam ----------
// Catatan: ini hanya penghalang sopan di sisi klien. Rate limit sungguhan
// perlu edge function / batasan server (lihat README).

const RATE_KEY = "rpb-report-times";
const RATE_MAX = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function readRateTimes() {
  try {
    const raw = localStorage.getItem(RATE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((t) => Date.now() - t < RATE_WINDOW_MS) : [];
  } catch {
    return [];
  }
}

function checkRateLimit() {
  if (readRateTimes().length >= RATE_MAX) {
    throw new Error(
      "Kamu sudah mengirim 5 laporan dalam sejam terakhir. Tunggu sebentar lalu coba lagi."
    );
  }
}

function recordRateHit() {
  try {
    localStorage.setItem(RATE_KEY, JSON.stringify([...readRateTimes(), Date.now()]));
  } catch {
    // mode privat: abaikan, server tetap memvalidasi isi laporan
  }
}

// ---------- kode rahasia penyelenggara ----------
// Dibuat di klien, yang disimpan hanya hash SHA-256 hex. Kode asli ditampilkan
// SEKALI di UI saat aksi dibuat; verifikasi terjadi di dalam RPC finish_event.

function makeSecret() {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((b) => abc[b % abc.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`;
}

async function sha256Hex(text) {
  if (!crypto.subtle) {
    throw new Error("Browser tidak mendukung kriptografi aman. Pakai HTTPS atau localhost.");
  }
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- kompresi foto sisi klien (tanpa library baru) ----------

function loadBitmap(file) {
  if ("createImageBitmap" in window) {
    return createImageBitmap(file, { imageOrientation: "from-image" }).catch(() =>
      createImageBitmap(file)
    );
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Foto tidak bisa dibaca."));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Foto gagal dikompres."))),
      "image/jpeg",
      quality
    );
  });
}

export async function compressImage(file) {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (bitmap.close) bitmap.close();
  return canvasToBlob(canvas, PHOTO_QUALITY);
}

// ---------- pemetaan baris DB <-> model aplikasi ----------

function mapReport(row) {
  return {
    id: row.id,
    beach: row.beach,
    lat: row.lat,
    lng: row.lng,
    severity: row.severity,
    type: row.type ?? "sampah",
    wasteType: row.waste_type ?? row.wasteType ?? "mixed",
    wasteAmount: row.waste_amount ?? row.wasteAmount ?? "small",
    note: row.note ?? "",
    photo: row.photo_url ?? row.photo ?? "",
    takenAt: row.taken_at ?? row.takenAt,
    source: row.source,
  };
}

function mapEvent(row) {
  return {
    id: row.id,
    title: row.title,
    beach: row.beach,
    date: typeof row.date === "string" ? row.date.slice(0, 10) : row.date,
    organizer: row.organizer,
    slots: row.slots,
    joined: row.joined,
    status: row.status,
    kg: row.kg != null ? Number(row.kg) : undefined,
    volunteers: row.volunteers ?? undefined,
  };
}

// ---------- pesan error bersahabat ----------

function friendlyDbError(err, fallback) {
  const msg = String(err?.message ?? "");
  if (msg.includes("EVENT_FULL")) return "Kuota aksi sudah penuh.";
  if (msg.includes("INVALID_SECRET"))
    return "Kode rahasia salah. Minta kode yang benar ke penyelenggara aksi.";
  if (msg.includes("EVENT_ALREADY_DONE")) return "Aksi ini sudah selesai.";
  if (msg.includes("EVENT_NOT_FOUND")) return "Aksi tidak ditemukan. Muat ulang halaman.";
  if (msg.includes("EVENT_NOT_PENDING")) return "Usulan ini sudah diproses sebelumnya.";
  if (msg.includes("NOT_ADMIN")) return "Hanya admin yang bisa memproses aksi.";
  if (msg.includes("VOLUNTEERS_OVER_QUOTA"))
    return "Jumlah relawan hadir tidak boleh melebihi kuota aksi.";
  if (msg.includes("VOLUNTEERS_OVER_JOINED"))
    return "Jumlah relawan hadir tidak boleh melebihi jumlah yang terdaftar.";
  if (msg.includes("PROPOSAL_NOT_FOUND")) return "Laporan hasil tidak ditemukan. Muat ulang halaman.";
  if (msg.includes("PROPOSAL_NOT_PENDING")) return "Laporan hasil ini sudah diproses sebelumnya.";
  if (msg.includes("INVALID_KG")) return "Isi berat sampah dengan angka lebih dari 0.";
  if (msg.includes("INVALID_VOLUNTEERS")) return "Isi relawan hadir dengan angka lebih dari 0.";
  if (err?.code === "23514")
    return "Lokasi di luar jangkauan (maksimal 15 km dari pusat Bali).";
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("fetch"))
    return "Tidak bisa terhubung ke server. Periksa koneksi internet lalu coba lagi.";
  return fallback;
}

// ---------- API laporan ----------

export async function listReports() {
  if (!isSupabaseConfigured) {
    const { demoReports } = demoStore();
    return [...demoReports].sort((a, b) => new Date(b.takenAt) - new Date(a.takenAt));
  }
  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .order("taken_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(friendlyDbError(error, "Gagal memuat laporan. Coba muat ulang."));
  return data.map(mapReport);
}

export async function createReport(report, file) {
  checkRateLimit();
  if (distanceKm(report.lat, report.lng, BALI_CENTER.lat, BALI_CENTER.lng) > MAX_KM) {
    throw new Error("Lokasi di luar jangkauan (maksimal 15 km dari pusat Bali).");
  }

  let photoUrl = report.photo || "";
  if (file) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      throw new Error("File bukan gambar. Pilih file foto berformat JPG, PNG, atau WebP.");
    }
    if (!isSupabaseConfigured) {
      photoUrl = report.photo || "";
    } else {
      const blob = await compressImage(file);
      const path = `${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (upErr) {
        throw new Error(
          friendlyDbError(upErr, "Foto gagal diunggah. Coba foto lain atau kirim tanpa foto.")
        );
      }
      photoUrl = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
    }
  }

  if (!isSupabaseConfigured) {
    const { demoReports } = demoStore();
    const row = { ...report, id: `r-demo-${Date.now()}-${demoSeq++}`, photo: photoUrl };
    demoReports.unshift(row);
    recordRateHit();
    return row;
  }

  const { data, error } = await supabase
    .from("reports")
    .insert({
      beach: report.beach,
      lat: report.lat,
      lng: report.lng,
      severity: report.severity,
      type: report.type ?? "sampah",
      // Kolom baru (lihat migrasi waste columns). Jika backend belum dimigrasi,
      // insert tanpa kolom ini tetap jalan karena kita kirim via spread kondisional.
      ...(report.wasteType ? { waste_type: report.wasteType } : {}),
      ...(report.wasteAmount ? { waste_amount: report.wasteAmount } : {}),
      note: report.note || "",
      photo_url: photoUrl,
      taken_at: report.takenAt,
      source: report.source,
    })
    .select()
    .single();
  if (error) throw new Error(friendlyDbError(error, "Laporan gagal dikirim. Coba lagi."));
  recordRateHit();
  return mapReport(data);
}

// Langganan laporan baru (dipakai tahap realtime). Mengembalikan fungsi berhenti.
export function subscribeReports(onReport) {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const channel = supabase
    .channel("reports-insert")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "reports" },
      (payload) => onReport(mapReport(payload.new))
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// ---------- API aksi ----------
// Model moderasi: publik mengusulkan (status 'pending', tidak tampil di
// daftar publik), admin menyetujui lewat approveEvent -> 'upcoming'.
// Penegakan sungguhan ada di RLS + RPC approve_event (migrasi
// 20260301000000_event_moderation.sql); filter di sini menjaga konsistensi
// tampilan antara mode demo dan mode Supabase.

export async function listEvents() {
  if (!isSupabaseConfigured) {
    const { demoEvents } = demoStore();
    return demoEvents
      .filter((e) => e.status === "upcoming" || e.status === "done")
      .map(mapEvent);
  }
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .in("status", ["upcoming", "done"])
    .order("date", { ascending: true });
  if (error) throw new Error(friendlyDbError(error, "Gagal memuat aksi. Coba muat ulang."));
  return data.map(mapEvent);
}

// Antrean usulan aksi: hanya bisa dibaca admin (ditegakkan RLS di backend).
export async function listPendingEvents() {
  if (!isSupabaseConfigured) {
    const { demoEvents } = demoStore();
    return demoEvents
      .filter((e) => e.status === "pending")
      .map(mapEvent)
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("status", "pending")
    .order("date", { ascending: true });
  if (error) throw new Error(friendlyDbError(error, "Gagal memuat antrean usulan. Coba muat ulang."));
  return data.map(mapEvent);
}

export async function createEvent(event) {
  const secret = makeSecret();
  const organizer_secret_hash = await sha256Hex(secret);

  if (!isSupabaseConfigured) {
    const { demoEvents } = demoStore();
    const row = {
      ...mapEvent({
        id: `e-demo-${Date.now()}-${demoSeq++}`,
        title: event.title,
        beach: event.beach,
        date: event.date,
        organizer: event.organizer,
        slots: event.slots,
        joined: 0,
        status: "pending",
        kg: null,
        volunteers: null,
      }),
    };
    demoEvents.push({ ...event, id: row.id, joined: 0, status: "pending", organizer_secret_hash });
    return { event: row, secret };
  }

  const { data, error } = await supabase
    .from("events")
    .insert({
      title: event.title,
      beach: event.beach,
      date: event.date,
      organizer: event.organizer,
      slots: event.slots,
      joined: 0,
      status: "pending",
      organizer_secret_hash,
    })
    .select()
    .single();
  if (error) throw new Error(friendlyDbError(error, "Usulan gagal dikirim. Coba lagi."));
  return { event: mapEvent(data), secret };
}

// Persetujuan admin: setujui (true) -> 'upcoming', tolak (false) -> 'rejected'.
export async function approveEvent(id, approve) {
  if (!isSupabaseConfigured) {
    const { demoEvents } = demoStore();
    const e = demoEvents.find((x) => x.id === id);
    if (!e) throw new Error("Aksi tidak ditemukan. Muat ulang halaman.");
    if (e.status !== "pending") throw new Error("Usulan ini sudah diproses sebelumnya.");
    e.status = approve ? "upcoming" : "rejected";
    return mapEvent(e);
  }
  const { data, error } = await supabase.rpc("approve_event", {
    p_event_id: id,
    p_approve: Boolean(approve),
  });
  if (error) throw new Error(friendlyDbError(error, "Persetujuan gagal disimpan. Coba lagi."));
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Persetujuan gagal disimpan. Coba lagi.");
  return mapEvent(row);
}

// ---------- Gerbang admin sisi klien (mode demo / UI) ----------
// Ini hanya gerbang tampilan agar panel persetujuan tidak terbuka untuk
// sembarang pengunjung. Penegakan aslinya ada di database (tabel admins +
// RPC approve_event) saat Supabase terkonfigurasi.
// Atur kode via env VITE_ADMIN_CODE (lihat .env.example). Nilai bawaan
// di bawah hanya untuk mode demo lokal — GANTI di produksi.
const ADMIN_KEY = "rpb-admin";

function expectedAdminCode() {
  const env = import.meta?.env ?? {};
  return env.VITE_ADMIN_CODE || "bali1234";
}

export function isAdminAuthenticated() {
  try {
    return localStorage.getItem(ADMIN_KEY) === "1";
  } catch {
    return false;
  }
}

export function adminLogin(code) {
  if (!String(code ?? "").trim()) {
    throw new Error("Isi kode admin dulu.");
  }
  if (String(code).trim() !== expectedAdminCode()) {
    throw new Error("Kode admin salah.");
  }
  try {
    localStorage.setItem(ADMIN_KEY, "1");
  } catch {
    // mode privat: sesi admin hanya bertahan selama halaman terbuka
  }
  return true;
}

// ---------- API usulan hasil lapangan ----------
// Relawan/penyelenggara mengirim angka dari lapangan (kg, hadir, foto bukti)
// per aksi; admin memverifikasi di tab Admin lalu mengesahkan (angka usulan
// dipakai sebagai hasil resmi) atau menolak. Angka mentah TIDAK mengubah
// statistik sebelum disahkan. Lihat migrasi 20260501000000_result_proposals.sql.

function mapProposal(row) {
  return {
    id: row.id,
    eventId: row.event_id ?? row.eventId,
    kg: Number(row.kg),
    volunteers: Number(row.volunteers),
    cleanedIds: row.cleaned_ids ?? row.cleanedIds ?? [],
    photo: row.photo_url ?? row.photo ?? "",
    note: row.note ?? "",
    createdAt: row.created_at ?? row.createdAt,
    status: row.status ?? "pending",
  };
}

function demoProposalStore() {
  if (!demoProposals) {
    demoProposals = SEED_PROPOSALS.map((p) => ({ ...p }));
  }
  return demoProposals;
}

export async function createResultProposal(draft, file) {
  const kg = Number(draft.kg);
  const volunteers = Number(draft.volunteers);
  if (!Number.isFinite(kg) || kg <= 0) {
    throw new Error("Isi perkiraan sampah dalam kg dengan angka lebih dari 0.");
  }
  if (!Number.isInteger(volunteers) || volunteers <= 0) {
    throw new Error("Isi jumlah relawan hadir dengan bilangan bulat lebih dari 0.");
  }
  const cleanedIds = Array.isArray(draft.cleanedIds) ? draft.cleanedIds : [];
  if (!isSupabaseConfigured) {
    if (!draft.photo) {
      throw new Error("Lampirkan foto bukti pantai yang sudah dibersihkan dulu.");
    }
    const { demoEvents } = demoStore();
    const target = demoEvents.find((x) => x.id === draft.eventId);
    if (!target) throw new Error("Aksi tidak ditemukan. Muat ulang halaman.");
    if (Number.isFinite(target.slots) && volunteers > target.slots) {
      throw new Error("Jumlah relawan hadir tidak boleh melebihi kuota aksi.");
    }
    if (Number.isFinite(target.joined) && volunteers > target.joined) {
      throw new Error("Jumlah relawan hadir tidak boleh melebihi jumlah yang terdaftar.");
    }
    const now = new Date().toISOString();
    const row = {
      id: `p-demo-${Date.now()}-${demoSeq++}`,
      eventId: draft.eventId,
      kg,
      volunteers,
      cleanedIds,
      photo: draft.photo || "",
      note: draft.note || "",
      createdAt: now,
      status: "pending",
    };
    demoProposalStore().unshift(row);
    return { ...row };
  }
  // Mode Supabase: validasi dini ke aksi terkait agar pesan ramah (penegakan
  // final tetap di finish_event saat pengesahan).
  const { data: target, error: targetErr } = await supabase
    .from("events")
    .select("slots, joined, status")
    .eq("id", draft.eventId)
    .single();
  if (targetErr || !target) throw new Error("Aksi tidak ditemukan. Muat ulang halaman.");
  if (Number.isFinite(target.slots) && volunteers > target.slots) {
    throw new Error("Jumlah relawan hadir tidak boleh melebihi kuota aksi.");
  }
  if (Number.isFinite(target.joined) && volunteers > target.joined) {
    throw new Error("Jumlah relawan hadir tidak boleh melebihi jumlah yang terdaftar.");
  }
  // Mode Supabase: foto bukti wajib — kompres + unggah ke storage agar yang
  // tersimpan berupa public URL ringan (pola yang sama dengan createReport).
  let photoUrl = "";
  const uploadFile = file ?? draft.photoFile ?? null;
  if (uploadFile) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(uploadFile.type)) {
      throw new Error("File bukan gambar. Pilih file foto berformat JPG, PNG, atau WebP.");
    }
    const blob = await compressImage(uploadFile);
    const path = `${crypto.randomUUID()}.jpg`;
    const { error: upErr } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (upErr) {
      throw new Error(
        friendlyDbError(upErr, "Foto gagal diunggah. Coba foto lain.")
      );
    }
    photoUrl = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
  }
  if (!photoUrl) {
    throw new Error("Lampirkan foto bukti pantai yang sudah dibersihkan dulu.");
  }
  const { data, error } = await supabase
    .from("result_proposals")
    .insert({
      event_id: draft.eventId,
      kg,
      volunteers,
      cleaned_ids: cleanedIds,
      photo_url: photoUrl,
      note: draft.note || "",
      status: "pending",
    })
    .select()
    .single();
  if (error) throw new Error(friendlyDbError(error, "Laporan hasil gagal dikirim. Coba lagi."));
  return mapProposal(data);
}

// Antrean verifikasi: hanya bisa dibaca admin (ditegakkan RLS di backend).
export async function listPendingProposals() {
  if (!isSupabaseConfigured) {
    return demoProposalStore()
      .filter((p) => p.status === "pending")
      .map((p) => ({ ...p }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  const { data, error } = await supabase
    .from("result_proposals")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(friendlyDbError(error, "Gagal memuat laporan hasil. Coba muat ulang."));
  return data.map(mapProposal);
}

// Tandai usulan diterima/ditolak (dipakai saat admin mengesahkan/menolak).
export async function resolveProposal(id, accept) {
  if (!isSupabaseConfigured) {
    const list = demoProposalStore();
    const p = list.find((x) => x.id === id);
    if (!p) throw new Error("Laporan hasil tidak ditemukan. Muat ulang halaman.");
    if (p.status !== "pending") throw new Error("Laporan hasil ini sudah diproses sebelumnya.");
    p.status = accept ? "accepted" : "rejected";
    return { ...p };
  }
  const { data, error } = await supabase.rpc("resolve_proposal", {
    p_proposal_id: id,
    p_accept: Boolean(accept),
  });
  if (error) throw new Error(friendlyDbError(error, "Laporan hasil gagal diproses. Coba lagi."));
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Laporan hasil gagal diproses. Coba lagi.");
  return mapProposal(row);
}

export function adminLogout() {
  try {
    localStorage.removeItem(ADMIN_KEY);
  } catch {
    // abaikan
  }
}

// ---------- Auth admin Supabase (mode backend) ----------
// Login admin UI (PIN di atas) hanya gerbang tampilan. Saat backend aktif,
// RPC approve/finish/resolve mengecek public.is_admin() = auth.uid() dari
// Supabase Auth, sehingga admin WAJIB login email+password yang UUID-nya
// terdaftar di public.admins (lihat migrasi 20260301000000).
// PIN tetap dipakai hanya untuk mode demo (tanpa backend).

export async function getAdminSession() {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}

export async function adminSignIn(email, password) {
  if (!isSupabaseConfigured) throw new Error("Backend belum dikonfigurasi.");
  if (!String(email ?? "").trim() || !String(password ?? "")) {
    throw new Error("Isi email dan kata sandi dulu.");
  }
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(email).trim(),
    password: String(password),
  });
  if (error) throw new Error("Email atau kata sandi salah.");
  const { data: admin, error: adminErr } = await supabase.rpc("is_admin");
  if (adminErr || !admin) {
    await supabase.auth.signOut();
    throw new Error("Akun ini bukan admin. Minta akses ke pengelola.");
  }
  try {
    localStorage.setItem(ADMIN_KEY, "1");
  } catch {
    // abaikan
  }
  return data.session;
}

export async function adminSignOut() {
  adminLogout();
  if (isSupabaseConfigured) {
    try {
      await supabase.auth.signOut();
    } catch {
      // abaikan
    }
  }
}

export async function isBackendAdmin() {
  if (!isSupabaseConfigured) return false;
  try {
    const { data, error } = await supabase.rpc("is_admin");
    return !error && data === true;
  } catch {
    return false;
  }
}

export function onAdminSessionChange(cb) {
  if (!isSupabaseConfigured) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

export async function joinEvent(id) {
  if (!isSupabaseConfigured) {
    const { demoEvents } = demoStore();
    const e = demoEvents.find((x) => x.id === id);
    if (!e || e.status === "done" || e.joined >= e.slots) {
      throw new Error("Kuota aksi sudah penuh.");
    }
    e.joined += 1;
    return mapEvent(e);
  }
  const { data, error } = await supabase.rpc("join_event", { p_event_id: id });
  if (error) throw new Error(friendlyDbError(error, "Gagal bergabung. Coba lagi."));
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Kuota aksi sudah penuh.");
  return mapEvent(row);
}

export async function finishEvent(id, secret, kg, volunteers) {
  if (!isSupabaseConfigured) {
    const { demoEvents } = demoStore();
    const e = demoEvents.find((x) => x.id === id);
    if (!e) throw new Error("Aksi tidak ditemukan. Muat ulang halaman.");
    // Mode demo: pencatatan hasil hanya untuk admin (lihat gerbang kode
    // admin di bawah; penegakan sungguhan di RPC finish_event saat
    // Supabase terkonfigurasi).
    if (!isAdminAuthenticated()) {
      throw new Error("Hanya admin yang bisa memproses aksi.");
    }
    if (e.status !== "upcoming") throw new Error("Aksi ini sudah selesai.");
    if (Number.isFinite(e.slots) && e.slots > 0 && volunteers > e.slots) {
      throw new Error("Jumlah relawan hadir tidak boleh melebihi kuota aksi.");
    }
    if (Number.isFinite(e.joined) && volunteers > e.joined) {
      throw new Error("Jumlah relawan hadir tidak boleh melebihi jumlah yang terdaftar.");
    }
    if ((await sha256Hex(secret)) !== e.organizer_secret_hash) {
      throw new Error("Kode rahasia salah. Minta kode yang benar ke penyelenggara aksi.");
    }
    e.status = "done";
    e.kg = kg;
    e.volunteers = volunteers;
    return mapEvent(e);
  }
  const { data, error } = await supabase.rpc("finish_event", {
    p_event_id: id,
    p_secret: secret,
    p_kg: kg,
    p_volunteers: volunteers,
  });
  if (error) throw new Error(friendlyDbError(error, "Hasil gagal disimpan. Coba lagi."));
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Hasil gagal disimpan. Coba lagi.");
  return mapEvent(row);
}
