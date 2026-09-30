import { useMemo, useState } from "react";
import { SEVERITY } from "./data.js";
import { fmtDate, timeAgo } from "./utils.js";

const inputCls =
  "mt-1 block min-h-[48px] w-full rounded-xl border border-tide/20 bg-white px-4 py-3 text-base placeholder:text-tide/60 dark:border-foam/30 dark:bg-slate-700 dark:text-foam dark:placeholder:text-foam/60";

// Panel admin di tab navbar "Admin" (terpisah dari tab Aksi clean-up).
// - Belum login: form kode admin (mode demo) atau email+password Supabase
//   (mode backend — wajib agar RPC is_admin() lolos).
// - Sudah login: antrean usulan aksi + laporan hasil lapangan yang menunggu
//   verifikasi, masing-masing dengan tombol Setujui/Sahkan dan Tolak.
function AdminPanel({ events, proposals, reports, isAdmin, useBackend, onApprove, onConfirmProposal, onRejectProposal, onAdminLogin, onAdminLogout }) {
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const pending = useMemo(
    () => (events ?? []).filter((e) => e.status === "pending").sort((a, b) => a.date.localeCompare(b.date)),
    [events]
  );

  // Laporan hasil lapangan yang menunggu, dikelompokkan per aksi (terbaru dulu).
  const pendingProposals = useMemo(
    () =>
      (proposals ?? [])
        .filter((p) => p.status === "pending")
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [proposals]
  );

  const eventById = useMemo(() => {
    const map = new Map();
    for (const e of events ?? []) map.set(e.id, e);
    return map;
  }, [events]);

  // Petakan id laporan ke laporannya agar dot titik yang ditandai bisa
  // diwarnai sesuai severity masing-masing (sama dengan warna dot di peta).
  const reportById = useMemo(() => {
    const map = new Map();
    for (const r of reports ?? []) map.set(r.id, r);
    return map;
  }, [reports]);

  async function handleLogin(e) {
    e.preventDefault();
    setBusy(true);
    const errMsg = await onAdminLogin(useBackend ? { email, password } : code);
    setBusy(false);
    if (errMsg) {
      setError(errMsg);
      return;
    }
    setCode("");
    setEmail("");
    setPassword("");
    setError("");
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <div className="rounded-2xl border border-tide/10 bg-white p-4 md:p-6 dark:border-foam/20 dark:bg-slate-800">
          <h2 className="font-display text-lg font-bold">Masuk sebagai admin</h2>
          <p className="mt-1 text-sm dark:text-foam/90">
            {useBackend
              ? "Masuk dengan akun admin yang terdaftar untuk menyetujui usulan dan mengesahkan hasil."
              : "Khusus admin untuk menyetujui usulan aksi clean-up dari warga."}
          </p>
          <form onSubmit={handleLogin} noValidate className="mt-3">
            {useBackend ? (
              <>
                <div>
                  <label htmlFor="admin-email" className="block text-sm font-bold">
                    Email admin
                  </label>
                  <input
                    id="admin-email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@contoh.id"
                    className={inputCls}
                  />
                </div>
                <div className="mt-2">
                  <label htmlFor="admin-password" className="block text-sm font-bold">
                    Kata sandi
                  </label>
                  <input
                    id="admin-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Masukkan kata sandi"
                    className={inputCls}
                  />
                </div>
              </>
            ) : (
              <>
                <label htmlFor="admin-kode" className="block text-sm font-bold">
                  Kode admin
                </label>
                <input
                  id="admin-kode"
                  type="password"
                  autoComplete="off"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Masukkan kode admin"
                  className={inputCls}
                />
              </>
            )}
            {error && (
              <p role="alert" className="mt-2 rounded-xl bg-sev-4/10 px-3 py-2 text-sm font-semibold text-ember dark:bg-sev-4/20">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="mt-3 min-h-[52px] w-full rounded-xl bg-tide text-base font-bold text-white disabled:opacity-60 dark:bg-foam dark:text-tide dark:disabled:opacity-50"
            >
              {busy ? "Memeriksa…" : "Masuk"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm dark:text-foam/90">
          <span aria-hidden="true">🔓 </span>
          <strong>Mode admin aktif.</strong>
        </p>
        <button
          type="button"
          onClick={onAdminLogout}
          className="min-h-[44px] shrink-0 rounded-xl border border-tide/20 bg-white px-5 text-sm font-semibold dark:border-foam/30 dark:bg-slate-700 dark:text-foam"
        >
          Keluar
        </button>
      </div>

      <h2 className="font-display mt-6 text-lg font-bold">
        Menunggu persetujuan{pending.length > 0 ? ` (${pending.length})` : ""}
      </h2>
      {pending.length === 0 ? (
        <p className="mt-2 text-sm dark:text-foam/90">Tidak ada usulan menunggu. Semua antrean sudah diproses.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {pending.map((e) => (
            <li key={e.id} className="rounded-2xl border border-dashed border-tide/25 bg-white p-4 dark:border-foam/25 dark:bg-slate-800">
              <p className="font-display text-base font-bold">
                {e.title}
              </p>
              <p className="mt-0.5 text-sm dark:text-foam/90">
                {e.beach} · {fmtDate(e.date)} · {e.organizer} · kuota {e.slots}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => onApprove(e.id, true)}
                  className="min-h-[48px] flex-1 rounded-xl bg-tide text-base font-bold text-white dark:bg-foam dark:text-tide"
                >
                  Setujui
                </button>
                <button
                  type="button"
                  onClick={() => onApprove(e.id, false)}
                  className="min-h-[48px] rounded-xl border border-tide/20 px-5 text-base font-semibold dark:border-foam/30 dark:bg-slate-700 dark:text-foam"
                >
                  Tolak
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="font-display mt-8 text-lg font-bold">
        Laporan hasil lapangan{pendingProposals.length > 0 ? ` (${pendingProposals.length})` : ""}
      </h2>
      <p className="mt-1 text-sm text-tide/70 dark:text-foam/70">
        Angka dari relawan di lapangan. Sahkan untuk menjadikannya hasil resmi aksi.
      </p>
      {pendingProposals.length === 0 ? (
        <p className="mt-2 text-sm dark:text-foam/90">Belum ada laporan hasil yang menunggu verifikasi.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {pendingProposals.map((p) => {
            const ev = eventById.get(p.eventId);
            return (
              <li key={p.id} className="rounded-2xl border border-dashed border-tide/25 bg-white p-4 dark:border-foam/25 dark:bg-slate-800">
                <p className="font-display text-base font-bold">
                  {ev ? ev.title : "Aksi tidak ditemukan"}
                </p>
                <p className="mt-0.5 text-sm dark:text-foam/90">
                  {p.kg.toLocaleString("id-ID")} kg · {p.volunteers} relawan hadir · {timeAgo(p.createdAt)}
                </p>
                {Array.isArray(p.cleanedIds) && p.cleanedIds.length > 0 && (
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-tide/70 dark:text-foam/70">
                    <span>Menandai {p.cleanedIds.length} titik dibersihkan</span>
                    <span
                      className="inline-flex items-center gap-1"
                      role="img"
                      aria-label={`Tingkat keparahan titik yang ditandai: ${p.cleanedIds
                        .map((id) => SEVERITY[reportById.get(id)?.severity]?.label ?? "tidak diketahui")
                        .join(", ")}`}
                    >
                      {p.cleanedIds.map((id) => {
                        const r = reportById.get(id);
                        const sev = r ? SEVERITY[r.severity] : null;
                        return (
                          <span
                            key={id}
                            title={r ? `${sev?.label ?? ""} · ${r.note?.trim() ? r.note : "(Tanpa catatan)"}` : "Laporan tidak ditemukan"}
                            aria-hidden="true"
                            className="inline-block h-3 w-3 rounded-full ring-1 ring-black/15 dark:ring-white/20"
                            style={{ backgroundColor: sev?.color ?? "#9db3ad" }}
                          />
                        );
                      })}
                    </span>
                  </p>
                )}
                {ev && (
                  <p className="mt-0.5 text-sm text-tide/70 dark:text-foam/70">
                    Kuota: {ev.slots} orang · Terdaftar: {ev.joined} orang · Status: {ev.status}
                  </p>
                )}
                {p.photo && (
                  <img src={p.photo} alt="Bukti hasil lapangan" className="mt-2 max-w-full rounded-lg" />
                )}
                {p.note && <p className="mt-1 text-sm dark:text-foam/90">{p.note}</p>}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onConfirmProposal(p.id)}
                    className="min-h-[48px] flex-1 rounded-xl bg-tide text-base font-bold text-white dark:bg-foam dark:text-tide"
                  >
                    Sahkan jadi hasil
                  </button>
                  <button
                    type="button"
                    onClick={() => onRejectProposal(p.id)}
                    className="min-h-[48px] rounded-xl border border-tide/20 px-5 text-base font-semibold dark:border-foam/30 dark:bg-slate-700 dark:text-foam"
                  >
                    Tolak
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default AdminPanel;
