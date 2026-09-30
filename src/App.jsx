import { Component, useEffect, useMemo, useState } from "react";
import AdminPanel from "./AdminPanel.jsx";
import CleanupBoard from "./CleanupBoard.jsx";
import MapView from "./MapView.jsx";
import ReportForm from "./ReportForm.jsx";
import { BEACHES, OLD_MS, SEED_EVENTS, SEED_PROPOSALS, SEED_REPORTS } from "./data.js";
import {
  adminLogin,
  adminSignIn,
  adminSignOut,
  approveEvent,
  createEvent,
  createReport,
  createResultProposal,
  finishEvent,
  getAdminSession,
  isAdminAuthenticated,
  isBackendAdmin,
  joinEvent,
  listEvents,
  listPendingEvents,
  listPendingProposals,
  listReports,
  onAdminSessionChange,
  resolveProposal,
  subscribeReports,
} from "./api.js";
import { isSupabaseConfigured } from "./supabase.js";
import { beachStatuses } from "./utils.js";
import { getInitialTheme, applyTheme, toggleTheme } from "./themeUtils.js";

const TABS = [
  { id: "peta", label: "Peta" },
  { id: "lapor", label: "Lapor" },
  { id: "aksi", label: "Bersih-Bersih" },
  { id: "admin", label: "Admin" },
];

// Backend aktif bila .env terisi (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY).
// Tanpa itu aplikasi berjalan mode demo: seed in-memory yang hilang saat refresh.
const useBackend = isSupabaseConfigured;

// Titik dot hijau hasil pengesahan: pantai preset memakai koordinat resmi;
// pantai custom/"Lainnya" memakai koordinat LAPORAN TERBARUNYA (bukan
// rata-rata, agar tidak jatuh di tengah antara titik-titik yang berjauhan).
// Mengembalikan { lat, lng } atau null bila tidak ada acuan lokasi.
function greenSpotFor(beachName, reports) {
  const preset = BEACHES.find((b) => b.name === beachName);
  if (preset) return { lat: preset.lat, lng: preset.lng };
  const list = reports
    .filter((r) => r.beach === beachName && Number.isFinite(r.lat) && Number.isFinite(r.lng))
    .sort((a, b) => new Date(b.takenAt) - new Date(a.takenAt));
  if (list.length === 0) return null;
  return { lat: list[0].lat, lng: list[0].lng };
}

// Gabung data server + seed (seed tetap tampil sesuai kesepakatan).
// Id tidak bertabrakan (seed "r1…"/"e1…" vs uuid server).
function mergeReports(server, seeds) {
  const seen = new Set(server.map((r) => r.id));
  const merged = [...server, ...seeds.filter((r) => !seen.has(r.id))];
  merged.sort((a, b) => new Date(b.takenAt) - new Date(a.takenAt));
  return merged;
}

function mergeById(server, local) {
  const seen = new Set(server.map((e) => e.id));
  return [...server, ...local.filter((e) => !seen.has(e.id))];
}

// Pengaman: galat render tidak boleh jadi layar putih kosong.
// key={activeTab} membuat batas ini reset setiap pindah tab.
class TabErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError() {
    return { error: true };
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert" className="rounded-2xl border border-tide/10 bg-white p-6 text-center dark:border-foam/20 dark:bg-slate-800">
          <p className="font-display text-lg font-bold">Halaman gagal dimuat</p>
          <p className="mt-1 text-sm">
            Terjadi galat tampilan. Data laporan dan aksi tidak hilang.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 min-h-[48px] rounded-xl bg-tide px-6 text-base font-bold text-white dark:bg-foam dark:text-tide"
          >
            Muat ulang halaman
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [activeTab, setActiveTab] = useState("peta");
  const [reports, setReports] = useState(SEED_REPORTS);
  const [events, setEvents] = useState(SEED_EVENTS);
  // Usulan hasil lapangan dari relawan (menunggu verifikasi admin sebelum
  // disahkan jadi angka resmi). Lihat result_proposals untuk mode Supabase.
  const [proposals, setProposals] = useState(SEED_PROPOSALS);
  const [selectedBeach, setSelectedBeach] = useState(null);
  const [toast, setToast] = useState(null);
  // Mode demo langsung siap; mode backend menunggu load awal selesai.
  const [dataReady, setDataReady] = useState(!useBackend);
  const [loadError, setLoadError] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  // Mode admin (gerbang panel persetujuan + pengesahan). Penegakan aslinya
  // ada di database (RLS + RPC); flag ini hanya mengendalikan tampilan.
  // Mode demo: PIN di localStorage. Mode backend: sesi Supabase Auth yang
  // UUID-nya terdaftar di public.admins (tanpa ini RPC selalu NOT_ADMIN).
  const [isAdmin, setIsAdmin] = useState(() => (useBackend ? false : isAdminAuthenticated()));
  // Theme: light | dark. Disimpan di localStorage + class "dark" di <html>.
  const [theme, setTheme] = useState(() => getInitialTheme());

  const statuses = useMemo(() => beachStatuses(reports), [reports]);

  // Apply theme saat berubah (termasuk saat pertama mount).
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Toast hilang sendiri setelah 4 detik (dipakai Fase 3-4).
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Muat awal + langganan realtime (hanya mode backend).
  useEffect(() => {
    if (!useBackend) return undefined;
    let cancelled = false;

    async function loadInitial() {
      setLoadError(null);
      try {
        const [serverReports, serverEvents] = await Promise.all([listReports(), listEvents()]);
        if (cancelled) return;
        setReports((prev) => mergeReports(serverReports, prev));
        setEvents((prev) => mergeById(serverEvents, prev));
        // Pulihkan sesi admin yang masih berlaku.
        const session = await getAdminSession();
        if (session && (await isBackendAdmin())) {
          if (!cancelled) setIsAdmin(true);
        }
        if (!cancelled) setDataReady(true);
      } catch (err) {
        if (!cancelled) setLoadError(err?.message ?? "Gagal memuat data dari server.");
      }
    }

    loadInitial();

    const offReports = subscribeReports((r) => {
      setReports((prev) => (prev.some((x) => x.id === r.id) ? prev : [r, ...prev]));
    });
    const offAuth = onAdminSessionChange(async (session) => {
      if (cancelled) return;
      if (!session) {
        setIsAdmin(false);
        return;
      }
      setIsAdmin(await isBackendAdmin());
    });
    return () => {
      cancelled = true;
      offReports();
      offAuth();
    };
  }, [loadAttempt]);

  // Antrean admin (usulan aksi + usulan hasil) hanya di-fetch untuk admin.
  useEffect(() => {
    if (!useBackend || !isAdmin || !dataReady) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const [pendEv, pendPr] = await Promise.all([listPendingEvents(), listPendingProposals()]);
        if (cancelled) return;
        setEvents((prev) => mergeById(pendEv, prev));
        setProposals((prev) => mergeById(pendPr, prev));
      } catch (err) {
        if (!cancelled) setToast(err?.message ?? "Gagal memuat antrean admin.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, dataReady]);

  function handleRetryLoad() {
    setLoadAttempt((n) => n + 1);
  }

  function handleToggleTheme() {
    setTheme((prev) => toggleTheme(prev));
  }

  async function handleSubmitReport(draft) {
    if (!useBackend) {
      const report = { ...draft, id: `r-${Date.now()}` };
      setReports((prev) => [report, ...prev]);
      setSelectedBeach(report.beach);
      setActiveTab("peta");
      setToast(`Laporan terkirim untuk ${report.beach}.`);
      return;
    }
    try {
      const saved = await createReport(draft, draft.photoFile ?? null);
      setReports((prev) => [saved, ...prev.filter((r) => r.id !== saved.id)]);
      setSelectedBeach(saved.beach);
      setActiveTab("peta");
      setToast(`Laporan terkirim untuk ${saved.beach}.`);
    } catch (err) {
      setToast(err?.message ?? "Laporan gagal dikirim. Coba lagi.");
    }
  }

  // Hanya aksi 'upcoming' yang bisa diikuti; usulan 'pending' tidak tampil
  // di publik sehingga tidak bisa digabung sebelum disetujui admin.
  async function handleJoin(eventId) {
    if (!useBackend) {
      let title = "";
      setEvents((prev) =>
        prev.map((e) => {
          if (e.id !== eventId || e.status !== "upcoming" || e.joined >= e.slots) return e;
          title = e.title;
          return { ...e, joined: e.joined + 1 };
        })
      );
      if (title) setToast(`Kamu bergabung di ${title}.`);
      return;
    }
    try {
      const updated = await joinEvent(eventId);
      setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, ...updated } : e)));
      setToast(`Kamu bergabung di ${updated.title}.`);
    } catch (err) {
      setToast(err?.message ?? "Gagal bergabung. Coba lagi.");
    }
  }

  // Usulan TIDAK langsung tampil di publik — menunggu persetujuan admin.
  async function handleCreateEvent(draft) {
    if (!useBackend) {
      const event = {
        ...draft,
        id: `e-${Date.now()}`,
        joined: 0,
        status: "pending",
      };
      setEvents((prev) => [...prev, event]);
      setToast(`Usulan "${event.title}" terkirim, menunggu persetujuan admin.`);
      return;
    }
    try {
      const { event } = await createEvent(draft);
      setEvents((prev) => [...prev, event]);
      setToast(`Usulan "${event.title}" terkirim, menunggu persetujuan admin.`);
    } catch (err) {
      setToast(err?.message ?? "Usulan gagal dikirim. Coba lagi.");
    }
  }

  async function handleApproveEvent(eventId, approve) {
    if (!useBackend) {
      let title = "";
      setEvents((prev) =>
        prev.map((e) => {
          if (e.id !== eventId || e.status !== "pending") return e;
          title = e.title;
          return { ...e, status: approve ? "upcoming" : "rejected" };
        })
      );
      if (!title) return;
      setToast(
        approve
          ? `"${title}" disetujui dan tampil di jadwal berikutnya.`
          : `"${title}" ditolak.`
      );
      return;
    }
    if (!isAdmin) {
      setToast("Hanya admin yang bisa menyetujui usulan aksi.");
      return;
    }
    try {
      const updated = await approveEvent(eventId, approve);
      setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, ...updated } : e)));
      setToast(
        approve
          ? `"${updated.title}" disetujui dan tampil di jadwal berikutnya.`
          : `"${updated.title}" ditolak.`
      );
    } catch (err) {
      setToast(err?.message ?? "Persetujuan gagal disimpan. Coba lagi.");
    }
  }

  // Angka mentah TIDAK mengubah statistik — menunggu disahkan admin.
  async function handleProposeResult(eventId, draft) {
    const target = events.find((e) => e.id === eventId);
    if (!target || target.status !== "upcoming") {
      setToast("Aksi tidak ditemukan atau sudah selesai.");
      return;
    }
    const kg = Number(draft.kg);
    const volunteers = Number(draft.volunteers);
    if (!Number.isFinite(kg) || kg <= 0 || !Number.isInteger(volunteers) || volunteers <= 0) {
      setToast("Laporan hasil tidak valid. Periksa angka kg dan kehadiran.");
      return;
    }
    if (Number.isFinite(target.slots) && volunteers > target.slots) {
      setToast(`Jumlah relawan hadir (${volunteers}) melebihi kuota aksi (${target.slots} orang).`);
      return;
    }
    if (Number.isFinite(target.joined) && volunteers > target.joined) {
      setToast(`Jumlah relawan hadir (${volunteers}) melebihi jumlah yang terdaftar (${target.joined} orang).`);
      return;
    }
    if (!useBackend) {
      const proposal = {
        id: `p-${Date.now()}`,
        eventId,
        kg,
        volunteers,
        cleanedIds: Array.isArray(draft.cleanedIds) ? draft.cleanedIds : [],
        photo: draft.photo || "",
        note: (draft.note || "").trim(),
        createdAt: new Date().toISOString(),
        status: "pending",
      };
      setProposals((prev) => [proposal, ...prev]);
      setToast(`Laporan hasil untuk "${target.title}" terkirim, menunggu verifikasi admin.`);
      return;
    }
    try {
      const saved = await createResultProposal(
        {
          eventId,
          kg,
          volunteers,
          cleanedIds: Array.isArray(draft.cleanedIds) ? draft.cleanedIds : [],
          photo: "",
          note: (draft.note || "").trim(),
        },
        draft.photoFile ?? null
      );
      setProposals((prev) => [saved, ...prev.filter((p) => p.id !== saved.id)]);
      setToast(`Laporan hasil untuk "${target.title}" terkirim, menunggu verifikasi admin.`);
    } catch (err) {
      setToast(err?.message ?? "Laporan hasil gagal dikirim. Coba lagi.");
    }
  }

  // Satu-satunya jalan hasil resmi: sahkan usulan lapangan. Guard admin,
  // kuota, dan keterdaftar-an dicek di sini; titik yang dicentang relawan
  // ikut menghijau di peta beserta foto bukti.
  async function handleConfirmProposal(proposalId) {
    if (!isAdmin) {
      setToast("Hanya admin yang bisa mengesahkan laporan hasil.");
      return;
    }
    const proposal = proposals.find((p) => p.id === proposalId);
    if (!proposal || proposal.status !== "pending") return;
    const target = events.find((e) => e.id === proposal.eventId);
    if (!target || target.status !== "upcoming") {
      setToast("Aksi terkait sudah selesai atau tidak ditemukan.");
      return;
    }
    if (Number.isFinite(target.slots) && proposal.volunteers > target.slots) {
      setToast(`Jumlah relawan hadir (${proposal.volunteers}) melebihi kuota aksi (${target.slots} orang).`);
      return;
    }
    if (Number.isFinite(target.joined) && proposal.volunteers > target.joined) {
      setToast(`Jumlah relawan hadir (${proposal.volunteers}) melebihi jumlah yang terdaftar (${target.joined} orang).`);
      return;
    }
    if (!useBackend) {
      applyConfirmedResult(target, proposal);
      return;
    }
    try {
      const updated = await finishEvent(target.id, "", proposal.kg, proposal.volunteers);
      await resolveProposal(proposalId, true);
      setEvents((prev) => prev.map((e) => (e.id === target.id ? { ...e, ...updated } : e)));
      setProposals((prev) =>
        prev.map((p) => (p.id === proposalId ? { ...p, status: "accepted" } : p))
      );
      // Pantai preset: arsip yang dibersihkan + 1 hijau bukti (lihat bawah).
      // Pantai custom/"Lainnya": dot yang dibersihkan langsung menghijau di
      // tempat — tiap lokasi bisa punya hijau sendiri (mis. Gilimanuk dan
      // Amed yang sama-sama bernama "Lainnya"). Id, koordinat, catatan, dan
      // foto asli tidak berubah, tidak ada laporan baru.
      // Keduanya hanya lokal sesi ini (tidak ada API update/delete); saat
      // reload, data server muncul lagi via listReports.
      const isPreset = BEACHES.some((b) => b.name === target.beach);
      const wanted = new Set(Array.isArray(proposal.cleanedIds) ? proposal.cleanedIds : []);
      const nowMs = Date.now();
      function isCleanedTarget(r) {
        if (r.beach !== target.beach || r.severity <= 1) return false;
        if (wanted.size > 0 && !wanted.has(r.id)) return false;
        const t = new Date(r.takenAt).getTime();
        return !Number.isNaN(t) && nowMs - t <= OLD_MS && nowMs - t >= 0;
      }
      if (!isPreset) {
        setReports((prev) => prev.map((r) => (isCleanedTarget(r) ? { ...r, severity: 1 } : r)));
        setToast(`Hasil ${target.title} disahkan — status ${target.beach} membaik.`);
        return;
      }
      const spot = greenSpotFor(target.beach, reports);
      // Preset: 1 catatan hijau bukti di koordinat resmi + arsip yang dibersihkan.
      // Foto usulan sudah berupa URL Storage sehingga bisa dipakai langsung.
      if (spot) {
        try {
          const green = await createReport({
            beach: target.beach,
            lat: spot.lat,
            lng: spot.lng,
            severity: 1,
            type: "sampah",
            wasteType: "mixed",
            wasteAmount: "small",
            note: `Dibersihkan lewat aksi "${target.title}": ${proposal.kg} kg sampah terangkut.`,
            photo: proposal.photo || "",
            takenAt: new Date().toISOString(),
            source: "peta",
          });
          setReports((prev) => [
            green,
            ...prev.filter((r) => r.id !== green.id && !isCleanedTarget(r)),
          ]);
        } catch {
          setToast(`Hasil ${target.title} disahkan, tapi catatan hijau gagal disimpan.`);
          return;
        }
      } else {
        setReports((prev) => prev.filter((r) => !isCleanedTarget(r)));
      }
      setToast(`Hasil ${target.title} disahkan — status ${target.beach} membaik.`);
    } catch (err) {
      setToast(err?.message ?? "Pengesahan gagal disimpan. Coba lagi.");
    }
  }

  // Versi mode demo dari pengesahan (lihat handleConfirmProposal).
  function applyConfirmedResult(target, proposal) {
    const { kg, volunteers } = proposal;
    const wanted = new Set(Array.isArray(proposal.cleanedIds) ? proposal.cleanedIds : []);
    setProposals((prev) =>
      prev.map((p) => (p.id === proposal.id ? { ...p, status: "accepted" } : p))
    );
    setEvents((prev) =>
      prev.map((e) => (e.id === target.id ? { ...e, status: "done", kg, volunteers } : e))
    );
    const isPreset = BEACHES.some((b) => b.name === target.beach);
    const nowMs = Date.now();
    if (!isPreset) {
      // Custom/"Lainnya": langsung menghijau di tempat (lihat handleConfirmProposal).
      setReports((prev) =>
        prev.map((r) => {
          if (r.beach !== target.beach || r.severity <= 1) return r;
          if (wanted.size > 0 && !wanted.has(r.id)) return r;
          const t = new Date(r.takenAt).getTime();
          if (Number.isNaN(t) || nowMs - t > OLD_MS || nowMs - t < 0) return r;
          return { ...r, severity: 1 };
        })
      );
      setToast(`Hasil ${target.title} disahkan — status ${target.beach} membaik.`);
      return;
    }
    const spot = greenSpotFor(target.beach, reports);
    if (spot) {
      const record = {
        id: `r-bersih-${nowMs}`,
        beach: target.beach,
        lat: spot.lat,
        lng: spot.lng,
        severity: 1,
        type: "sampah",
        wasteType: "mixed",
        wasteAmount: "small",
        note: `Dibersihkan lewat aksi "${target.title}": ${kg} kg sampah terangkut.`,
        photo: proposal.photo || "",
        takenAt: new Date(nowMs).toISOString(),
        source: "peta",
      };
      // Arsipkan laporan kotor yang ditandai (lihat handleConfirmProposal):
      // dihapus dari daftar aktif agar tiap pantai menyisakan 1 hijau bukti.
      setReports((prev) => [
        record,
        ...prev.filter((r) => {
          if (r.beach !== target.beach || r.severity <= 1) return true;
          if (wanted.size > 0 && !wanted.has(r.id)) return true;
          const t = new Date(r.takenAt).getTime();
          if (Number.isNaN(t) || nowMs - t > OLD_MS || nowMs - t < 0) return true;
          return false;
        }),
      ]);
      setToast(`Hasil ${target.title} disahkan — status ${target.beach} membaik.`);
    } else {
      setToast(`Hasil ${target.title} disahkan.`);
    }
  }

  async function handleRejectProposal(proposalId) {
    if (!isAdmin) {
      setToast("Hanya admin yang bisa menolak laporan hasil.");
      return;
    }
    if (!useBackend) {
      let found = false;
      setProposals((prev) =>
        prev.map((p) => {
          if (p.id !== proposalId || p.status !== "pending") return p;
          found = true;
          return { ...p, status: "rejected" };
        })
      );
      if (found) setToast("Laporan hasil ditolak.");
      return;
    }
    try {
      await resolveProposal(proposalId, false);
      setProposals((prev) =>
        prev.map((p) => (p.id === proposalId ? { ...p, status: "rejected" } : p))
      );
      setToast("Laporan hasil ditolak.");
    } catch (err) {
      setToast(err?.message ?? "Penolakan gagal disimpan. Coba lagi.");
    }
  }

  // Mengembalikan null bila sukses, atau pesan error untuk ditampilkan form.
  // Mode backend memakai email+password Supabase; mode demo memakai kode/PIN.
  async function handleAdminLogin(input) {
    try {
      if (useBackend) {
        if (!input || typeof input !== "object") {
          return "Masuk admin backend memakai email dan kata sandi.";
        }
        await adminSignIn(input.email, input.password);
        setIsAdmin(true);
        setToast("Masuk sebagai admin.");
        return null;
      }
      adminLogin(input);
      setIsAdmin(true);
      setToast("Masuk sebagai admin.");
      return null;
    } catch (err) {
      return err?.message ?? "Gagal masuk.";
    }
  }

  async function handleAdminLogout() {
    await adminSignOut();
    setIsAdmin(false);
    setToast("Keluar dari mode admin.");
  }

  const showLoader = useBackend && !dataReady && !loadError;
  const showLoadError = useBackend && loadError && !dataReady;

  return (
    <div className="min-h-[100dvh] bg-foam text-tide dark:bg-slate-900 dark:text-foam">
      <header className="bg-tide text-white dark:bg-slate-800">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="font-display text-xl font-bold leading-tight md:text-2xl">
              Radar Pantai Bali
            </h1>
            <p className="text-sm text-white/85 dark:text-foam/75">
              Peta kebersihan, laporan warga, dan aksi clean-up.
            </p>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <nav aria-label="Navigasi utama">
              <div role="tablist" aria-label="Pilih tampilan" className="flex gap-2">
                {TABS.map((tab) => {
                  const active = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setActiveTab(tab.id)}
                      className={`min-h-[44px] rounded-full px-5 text-sm font-semibold transition-colors ${
                        active
                          ? "bg-white text-tide dark:bg-slate-700 dark:text-foam"
                          : "bg-white/10 text-white hover:bg-white/20 dark:bg-white/5 dark:hover:bg-white/10"
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </nav>
            <button
              type="button"
              onClick={handleToggleTheme}
              title={theme === 'light' ? 'Ganti ke mode gelap' : 'Ganti ke mode terang'}
              className="min-h-[44px] w-[44px] rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors dark:bg-white/5 dark:hover:bg-white/10"
            >
              {theme === 'light' ? '🌙' : '☀️'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6">
        {showLoader && (
          <section aria-label="Memuat data" className="mx-auto w-full max-w-2xl rounded-2xl border border-tide/10 bg-white p-6 text-center dark:border-foam/20 dark:bg-slate-800">
            <p className="font-display text-lg font-bold">Memuat data…</p>
            <p className="mt-1 text-sm">Mengambil laporan dan aksi dari server.</p>
          </section>
        )}
        {showLoadError && (
          <section aria-label="Gagal memuat data" className="mx-auto w-full max-w-2xl rounded-2xl border border-tide/10 bg-white p-6 text-center dark:border-foam/20 dark:bg-slate-800">
            <p role="alert" className="font-display text-lg font-bold">Gagal memuat data</p>
            <p className="mt-1 text-sm">{loadError} Periksa koneksi internet atau konfigurasi Supabase.</p>
            <button
              type="button"
              onClick={handleRetryLoad}
              className="mt-4 min-h-[48px] rounded-xl bg-tide px-6 text-base font-bold text-white dark:bg-foam dark:text-tide"
            >
              Coba lagi
            </button>
          </section>
        )}
        {dataReady && (
        <TabErrorBoundary key={activeTab}>
        {activeTab === "peta" && (
          <section aria-label="Peta kebersihan">
            <MapView
              reports={reports}
              statuses={statuses}
              selectedBeach={selectedBeach}
              onSelectBeach={setSelectedBeach}
              onGoReport={() => setActiveTab("lapor")}
            />
          </section>
        )}

        {activeTab === "lapor" && (
          <section aria-label="Lapor kondisi pantai" className="rounded-2xl border border-tide/10 bg-white p-4 md:p-6 dark:border-foam/20 dark:bg-slate-800">
            <ReportForm onSubmit={handleSubmitReport} />
          </section>
        )}

        {activeTab === "aksi" && (
          <section aria-label="Bersih-Bersih">
            <CleanupBoard
              events={events}
              reports={reports}
              onJoin={handleJoin}
              onCreate={handleCreateEvent}
              onProposeResult={handleProposeResult}
            />
          </section>
        )}

        {activeTab === "admin" && (
          <section aria-label="Panel admin">
            <AdminPanel
              events={events}
              proposals={proposals}
              reports={reports}
              isAdmin={isAdmin}
              useBackend={useBackend}
              onApprove={handleApproveEvent}
              onConfirmProposal={handleConfirmProposal}
              onRejectProposal={handleRejectProposal}
              onAdminLogin={handleAdminLogin}
              onAdminLogout={handleAdminLogout}
            />
          </section>
        )}
        </TabErrorBoundary>
        )}
      </main>

      {toast && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-full bg-tide px-5 py-3 text-center text-sm font-semibold text-white shadow-lg dark:bg-foam dark:text-tide"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

export default App;
