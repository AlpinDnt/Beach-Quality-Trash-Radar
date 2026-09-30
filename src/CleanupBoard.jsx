import { useEffect, useMemo, useRef, useState } from "react";
import { BEACHES, OLD_MS, SEVERITY } from "./data.js";
import { fmtDate, readFileAsDataURL, timeAgo, validateImageFile } from "./utils.js";

const inputCls =
  "mt-1 block min-h-[48px] w-full rounded-xl border border-tide/20 bg-white px-4 py-3 text-base placeholder:text-tide/60 dark:bg-slate-700 dark:text-foam dark:border-foam/30 dark:placeholder:text-foam/60";

// State upload foto bukti untuk form Lapor hasil (ProposeForm). Pratinjau memakai
// blob URL; data URL dipakai sebagai salinan permanen untuk mode demo, sedangkan File asli dipakai untuk upload
// storage saat Supabase terkonfigurasi (lihat api.createResultProposal).
function usePhotoUpload() {
  const [preview, setPreview] = useState("");
  const [dataUrl, setDataUrl] = useState("");
  const [name, setName] = useState("");
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState("");
  const ref = useRef("");

  useEffect(() => {
    return () => {
      if (ref.current) URL.revokeObjectURL(ref.current);
    };
  }, []);

  async function handleFile(picked) {
    setMsg("");
    if (!picked) return;
    const fileError = validateImageFile(picked);
    if (fileError) {
      setMsg(fileError);
      return;
    }
    if (ref.current) URL.revokeObjectURL(ref.current);
    ref.current = URL.createObjectURL(picked);
    setPreview(ref.current);
    setName(picked.name);
    setFile(picked);
    try {
      setDataUrl(await readFileAsDataURL(picked));
    } catch {
      setDataUrl("");
      setMsg("Foto tidak bisa dibaca. Coba foto lain.");
    }
  }

  function clear() {
    if (ref.current) URL.revokeObjectURL(ref.current);
    ref.current = "";
    setPreview("");
    setDataUrl("");
    setName("");
    setFile(null);
    setMsg("");
  }

  return { preview, dataUrl, name, file, msg, handleFile, clear };
}

// Blok input foto bukti (wajib) untuk form Lapor hasil.
function PhotoField({ idPrefix, label, hint, photo }) {
  const inputId = `${idPrefix}-foto`;
  return (
    <div className="mt-3">
      <label htmlFor={inputId} className="block text-sm font-bold">
        {label}
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/*"
        onChange={(e) => photo.handleFile(e.target.files?.[0])}
        className={inputCls}
      />
       <p className="mt-1 text-sm text-tide/70 dark:text-foam/70">
         {hint} {photo.name ? `Dipilih: ${photo.name}.` : ""}
       </p>
      {photo.preview && (
        <div>
           <img
             src={photo.preview}
             alt="Pratinjau foto bukti"
             className="mt-2 max-h-96 w-full rounded-xl border border-tide/10 bg-foam object-contain dark:border-foam/10 dark:bg-slate-900"
           />
           <button
             type="button"
             onClick={photo.clear}
             className="mt-2 min-h-[44px] rounded-full border border-tide/20 px-5 text-sm font-semibold dark:border-foam/20 dark:text-foam"
           >
             Hapus foto
           </button>
        </div>
      )}
      {photo.msg && (
        <p role="alert" className="mt-2 rounded-xl bg-sev-4/10 px-3 py-2 text-sm font-semibold text-ember">
          {photo.msg}
        </p>
      )}
    </div>
  );
}
// Batas tegas kehadiran: tidak boleh melebihi kuota aksi maupun jumlah yang
// terdaftar (Gabung). Mengembalikan pesan error atau null bila valid.
function hadirError(volNum, slots, joined) {
  if (Number.isFinite(slots) && slots > 0 && volNum > slots) {
    return `Jumlah relawan hadir (${volNum}) melebihi kuota aksi (${slots} orang).`;
  }
  if (Number.isFinite(joined) && joined >= 0 && volNum > joined) {
    return `Jumlah relawan hadir (${volNum}) melebihi jumlah yang terdaftar (${joined} orang).`;
  }
  return null;
}

// Batas atas input hadir = yang terkecil dari kuota dan jumlah terdaftar.
function maxHadir(slots, joined) {
  const caps = [slots, joined].filter((n) => Number.isFinite(n) && n >= 0);
  return caps.length ? Math.min(...caps) : null;
}

// Form laporan hasil lapangan (publik): relawan/penyelenggara mengirim angka
// dari lapangan (kg, hadir, foto bukti wajib, catatan) per aksi.
// Angka mentah TIDAK menjadi hasil resmi — masuk antrean verifikasi admin.
function ProposeForm({ eventId, eventTitle, slots, joined, dirties, onPropose, onCancel }) {
  const [kg, setKg] = useState("");
  const [volunteers, setVolunteers] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const photo = usePhotoUpload();
  // Centang bawaan: semua tanda kotor ikut dibersihkan, bisa dikurangi.
  const [sel, setSel] = useState(() => dirties.map((r) => r.id));

  function handlePropose(e) {
    e.preventDefault();
    const kgNum = Number(kg);
    const volNum = Number(volunteers);
    if (!Number.isFinite(kgNum) || kgNum <= 0) {
      setError("Isi perkiraan sampah dalam kg dengan angka lebih dari 0.");
      return;
    }
    if (!Number.isInteger(volNum) || volNum <= 0) {
      setError("Isi jumlah relawan hadir dengan bilangan bulat lebih dari 0.");
      return;
    }
    const limitError = hadirError(volNum, slots, joined);
    if (limitError) {
      setError(limitError);
      return;
    }
    if (!photo.dataUrl) {
      setError("Lampirkan foto bukti pantai yang sudah dibersihkan dulu.");
      return;
    }
    onPropose({ kg: kgNum, volunteers: volNum, cleanedIds: sel, photo: photo.dataUrl, photoFile: photo.file, note: note.trim() });
  }

  const max = maxHadir(slots, joined);

  return (
     <form onSubmit={handlePropose} noValidate className="mt-3 border-t border-tide/10 pt-3 dark:border-foam/10">
       <p className="text-sm font-bold">Lapor hasil {eventTitle}</p>
       <p className="mt-0.5 text-sm text-tide/70 dark:text-foam/70">
         Terkirim ke admin untuk diverifikasi, belum menjadi angka resmi.
       </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={`hasil-kg-${eventId}`} className="block text-sm font-bold">
            Sampah (kg)
          </label>
          <input
            id={`hasil-kg-${eventId}`}
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={kg}
            onChange={(e) => setKg(e.target.value)}
            placeholder="cth. 85"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor={`hasil-hadir-${eventId}`} className="block text-sm font-bold">
            Relawan hadir
          </label>
          <input
            id={`hasil-hadir-${eventId}`}
            type="number"
            min="0"
            max={max ?? undefined}
            step="1"
            inputMode="numeric"
            value={volunteers}
            onChange={(e) => setVolunteers(e.target.value)}
            placeholder="cth. 24"
            className={inputCls}
          />
        </div>
      </div>
       {Number.isFinite(slots) && slots > 0 && (
         <p className="mt-1 text-sm text-tide/70 dark:text-foam/70">
           Kuota: {slots} orang{Number.isFinite(joined) ? ` · Terdaftar: ${joined} orang` : ""}{max != null ? ` · Hadir maks ${max} orang.` : ""}
         </p>
       )}
      {dirties.length > 0 && (
        <div className="mt-3">
           <p className="text-sm font-bold">Tanda yang dibersihkan</p>
           <label className="mt-1 flex min-h-[44px] cursor-pointer items-center gap-3 text-sm font-semibold dark:text-foam">
             <input
               type="checkbox"
               className="h-5 w-5 shrink-0 accent-[#0b3b4a]"
               checked={sel.length === dirties.length}
               onChange={(ev) => setSel(ev.target.checked ? dirties.map((r) => r.id) : [])}
             />
             Pilih semua
           </label>
           <ul className="divide-y divide-tide/10 border-t border-tide/10 dark:divide-foam/10 dark:border-foam/10">
            {dirties.map((r) => (
              <li key={r.id}>
                <label className="flex min-h-[48px] cursor-pointer items-start gap-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 shrink-0 accent-[#0b3b4a]"
                    checked={sel.includes(r.id)}
                    onChange={() =>
                      setSel((prev) =>
                        prev.includes(r.id)
                          ? prev.filter((x) => x !== r.id)
                          : [...prev, r.id]
                      )
                    }
                  />
                  <span
                    aria-hidden="true"
                    title={SEVERITY[r.severity]?.label}
                    className="mt-1 h-4 w-4 shrink-0 rounded-full ring-1 ring-black/15"
                    style={{ backgroundColor: SEVERITY[r.severity]?.color }}
                  />
                  <span>
                    <span className="block font-semibold">
                      {r.note?.trim() ? r.note : "(Tanpa catatan)"}
                    </span>
                    <span className="block">
                      {SEVERITY[r.severity]?.label} · {timeAgo(r.takenAt)}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-2">
        <label htmlFor={`hasil-catatan-${eventId}`} className="block text-sm font-bold">
          Catatan (opsional)
        </label>
        <input
          id={`hasil-catatan-${eventId}`}
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="cth. Sudah ditimbang panitia di pos selatan."
          className={inputCls}
        />
      </div>
      <PhotoField
        idPrefix={`lapor-${eventId}`}
        label="Foto bukti (wajib)"
        hint="Foto pantai yang sudah dibersihkan."
        photo={photo}
      />
       {error && (
         <p role="alert" className="mt-2 rounded-xl bg-sev-4/10 px-3 py-2 text-sm font-semibold text-ember dark:bg-sev-4/20">
           {error}
         </p>
       )}
      <div className="mt-2 flex gap-2">
       <button
           type="submit"
           className="min-h-[48px] flex-1 rounded-xl bg-tide text-base font-bold text-white dark:bg-foam dark:text-tide"
         >
           Kirim laporan
         </button>
         <button
           type="button"
           onClick={onCancel}
           className="min-h-[48px] rounded-xl border border-tide/20 px-5 text-base font-semibold dark:border-foam/20 dark:text-foam"
         >
           Batal
         </button>
      </div>
    </form>
  );
}

function CreateForm({ reports, onCreate }) {
  const [title, setTitle] = useState("");
  const [beach, setBeach] = useState(BEACHES[0].name);
  const [date, setDate] = useState("");
  const [organizer, setOrganizer] = useState("");
  const [slots, setSlots] = useState("");
  const [error, setError] = useState("");
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Pantai non-preset (mis. "Lainnya") yang muncul dari laporan warga:
  // dikumpulkan dari nama pantai unik di laporan agar aksi clean-up juga
  // bisa diusulkan untuk lokasi di luar daftar preset.
  const extraBeaches = useMemo(() => {
    const preset = new Set(BEACHES.map((b) => b.name));
    const seen = new Set();
    for (const r of reports ?? []) {
      const name = (r.beach || "").trim();
      if (name && !preset.has(name) && !seen.has(name)) seen.add(name);
    }
    return [...seen].sort((a, b) => a.localeCompare(b, "id"));
  }, [reports]);

  function handleCreate(e) {
    e.preventDefault();
    const slotsNum = Number(slots);
    if (!title.trim()) {
      setError("Isi nama aksi dulu.");
      return;
    }
    if (!beach) {
      setError("Pilih pantai dulu.");
      return;
    }
    if (!date) {
      setError("Pilih tanggal aksi dulu.");
      return;
    }
    if (date < today) {
      setError("Tanggal aksi tidak boleh di masa lalu.");
      return;
    }
    if (!organizer.trim()) {
      setError("Isi nama penyelenggara dulu.");
      return;
    }
    if (!Number.isInteger(slotsNum) || slotsNum <= 0) {
      setError("Isi kuota relawan dengan bilangan bulat lebih dari 0.");
      return;
    }
    onCreate({
      title: title.trim(),
      beach,
      date,
      organizer: organizer.trim(),
      slots: slotsNum,
    });
    setTitle("");
    setBeach(BEACHES[0].name);
    setDate("");
    setOrganizer("");
    setSlots("");
    setError("");
  }

  return (
    <form onSubmit={handleCreate} noValidate>
      <div>
        <label htmlFor="aksi-nama" className="block text-sm font-bold">
          Nama aksi
        </label>
        <input
          id="aksi-nama"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Contoh: Bersih Pagi Kuta"
          className={inputCls}
        />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="aksi-pantai" className="block text-sm font-bold">
            Pantai
          </label>
          <select
            id="aksi-pantai"
            value={beach}
            onChange={(e) => setBeach(e.target.value)}
            className={inputCls}
          >
            {BEACHES.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
            {extraBeaches.length > 0 && (
              <optgroup label="Lainnya (dari laporan)">
                {extraBeaches.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div>
          <label htmlFor="aksi-tanggal" className="block text-sm font-bold">
            Tanggal
          </label>
          <input
            id="aksi-tanggal"
            type="date"
            value={date}
            min={today}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="aksi-penyelenggara" className="block text-sm font-bold">
            Penyelenggara
          </label>
          <input
            id="aksi-penyelenggara"
            type="text"
            value={organizer}
            onChange={(e) => setOrganizer(e.target.value)}
            placeholder="Contoh: Komunitas Pantai Kuta"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="aksi-kuota" className="block text-sm font-bold">
            Kuota relawan
          </label>
          <input
            id="aksi-kuota"
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={slots}
            onChange={(e) => setSlots(e.target.value)}
            placeholder="cth. 30"
            className={inputCls}
          />
        </div>
      </div>
       {error && (
         <p role="alert" className="mt-3 rounded-xl bg-sev-4/10 px-3 py-2 text-sm font-semibold text-ember dark:bg-sev-4/20">
           {error}
         </p>
       )}
       <p className="mt-2 text-sm text-tide/70 dark:text-foam/70">
         Usulan tidak langsung tampil di publik — menunggu persetujuan admin.
       </p>
       <button
         type="submit"
         className="mt-3 min-h-[52px] w-full rounded-xl bg-tide text-base font-bold text-white dark:bg-foam dark:text-tide"
       >
         Kirim usulan
       </button>
    </form>
  );
}

function CleanupBoard({ events, reports, onJoin, onCreate, onProposeResult }) {
  const [proposingId, setProposingId] = useState(null);

  // Laporan kotor (severity > 1, 72 jam terakhir) di satu pantai, terbaru dulu.
  // Catatannya jadi opsi yang bisa dicentang satu per satu.
  function dirtyReportsFor(beach) {
    const now = Date.now();
    return (reports ?? [])
      .filter((r) => {
        if (r.beach !== beach || r.severity <= 1) return false;
        const t = new Date(r.takenAt).getTime();
        return !Number.isNaN(t) && now - t <= OLD_MS && now - t >= 0;
      })
      .sort((a, b) => new Date(b.takenAt) - new Date(a.takenAt));
  }

  const stats = useMemo(() => {
    const done = events.filter((e) => e.status === "done");
    return {
      kg: done.reduce((sum, e) => sum + (Number(e.kg) || 0), 0),
      done: done.length,
      volunteers: done.reduce((sum, e) => sum + (Number(e.volunteers) || 0), 0),
    };
  }, [events]);

  const upcoming = useMemo(
    () => events.filter((e) => e.status === "upcoming").sort((a, b) => a.date.localeCompare(b.date)),
    [events]
  );
  const done = useMemo(
    () => events.filter((e) => e.status === "done").sort((a, b) => b.date.localeCompare(a.date)),
    [events]
  );

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* Titik fokus halaman: total kg. Dua angka lain jadi kalimat pendamping, bukan kartu sejajar. */}
      <div>
        <p className="font-display text-5xl font-bold leading-none md:text-6xl">
          {stats.kg.toLocaleString("id-ID")}
          <span className="ml-2 align-middle text-xl font-semibold md:text-2xl">kg</span>
        </p>
        <p className="mt-2 text-base">
          sampah terangkut dari {stats.done} aksi selesai, {stats.volunteers} relawan turun tangan.
        </p>
      </div>

      <h2 className="font-display mt-8 text-lg font-bold">Jadwal Berikutnya</h2>
      {upcoming.length === 0 ? (
        <p className="mt-2 text-sm">Belum ada jadwal berikutnya. Buat jadwal pertama di bawah.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {upcoming.map((e) => {
            const full = e.joined >= e.slots;
            const pct = e.slots > 0 ? Math.min(100, Math.round((e.joined / e.slots) * 100)) : 0;
            const proposing = proposingId === e.id;
            const dirties = dirtyReportsFor(e.beach);
            return (
              <li key={e.id} className="rounded-2xl border border-tide/10 bg-white p-4 dark:border-foam/10 dark:bg-slate-800">
                <p className="font-display text-base font-bold">{e.title}</p>
                <p className="mt-0.5 text-sm">
                  {e.beach} · {fmtDate(e.date)} · {e.organizer}
                </p>
                <div className="mt-3">
                   <div
                     role="progressbar"
                     aria-label={`Kuota ${e.title}`}
                     aria-valuenow={e.joined}
                     aria-valuemin={0}
                     aria-valuemax={e.slots}
                     className="h-2.5 overflow-hidden rounded-full bg-tide/10 dark:bg-foam/10"
                   >
                     <div className="h-full rounded-full bg-tide dark:bg-foam" style={{ width: `${pct}%` }} />
                   </div>
                  <p className="mt-1 text-sm">
                    {e.joined} dari {e.slots} kuota terisi
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                   <button
                     type="button"
                     disabled={full}
                     onClick={() => onJoin(e.id)}
                     className="min-h-[48px] flex-1 rounded-xl bg-tide text-base font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-foam dark:text-tide"
                   >
                     {full ? "Penuh" : "Gabung"}
                   </button>
                   <button
                     type="button"
                     aria-expanded={proposing}
                     onClick={() => setProposingId(proposing ? null : e.id)}
                     className="min-h-[48px] rounded-xl border border-tide/20 px-5 text-base font-semibold dark:border-foam/20 dark:text-foam"
                   >
                     Lapor hasil
                   </button>
                </div>
                {proposing && (
                  <ProposeForm
                    eventId={e.id}
                    eventTitle={e.title}
                    slots={e.slots}
                    joined={e.joined}
                    dirties={dirties}
                    onCancel={() => setProposingId(null)}
                    onPropose={(draft) => {
                      onProposeResult(e.id, draft);
                      setProposingId(null);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="font-display mt-8 text-lg font-bold">Sudah selesai</h2>
      {done.length === 0 ? (
        <p className="mt-2 text-sm">Belum ada aksi selesai.</p>
      ) : (
         <ul className="mt-3 divide-y divide-tide/10 border-y border-tide/10 dark:divide-foam/10 dark:border-foam/10">
          {done.map((e) => (
            <li key={e.id} className="py-3">
              <p className="text-base font-bold">{e.title}</p>
              <p className="mt-0.5 text-sm">
                {e.beach} · {fmtDate(e.date)} · {(e.kg ?? 0).toLocaleString("id-ID")} kg ·{" "}
                {e.volunteers ?? 0} relawan
              </p>
            </li>
          ))}
        </ul>
      )}

      <h2 className="font-display mt-8 text-lg font-bold">Buat Jadwal Baru</h2>
        <div className="mt-3 rounded-2xl border border-tide/10 bg-white p-4 dark:border-foam/10 dark:bg-slate-800">
        <CreateForm reports={reports} onCreate={onCreate} />
      </div>
    </div>
  );
}

export default CleanupBoard;
