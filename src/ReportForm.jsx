import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import exifr from "exifr";
import { BEACHES, SEVERITY, WASTE_AMOUNTS, WASTE_TYPES } from "./data.js";
import { nearestBeach, readFileAsDataURL, validateImageFile } from "./utils.js";

const MINI_CENTER = [-8.72, 115.17];

// Zoom tujuan peta mini saat fokus ke satu titik (level detail jalan).
// Smart zoom: hanya zoom-in, tidak pernah zoom-out paksa.
const MINI_FOCUS_ZOOM = 14;

// Titik lokasi pilihan sebagai DivIcon HTML (bukan CircleMarker SVG) agar
// ukurannya konstan saat animasi zoom — masalah yang sama seperti di
// menu Peta. className "" agar style bawaan .leaflet-div-icon tidak dipakai.
const PICK_ICON = L.divIcon({
  className: "",
  html: '<div class="bq-pick"></div>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

function flyToPoint(map, lat, lng) {
  if (!map) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const nextZoom = Math.max(map.getZoom(), MINI_FOCUS_ZOOM);
  if (reduce) {
    if (nextZoom !== map.getZoom()) map.setView([lat, lng], nextZoom);
    else map.panTo([lat, lng]);
  } else {
    map.flyTo([lat, lng], nextZoom, { duration: 0.8 });
  }
}

// Menyimpan instance peta agar handler tombol bisa menerbangkan peta mini.
function MapHandle({ onReady }) {
  const map = useMap();
  useEffect(() => {
    onReady(map);
  }, [map, onReady]);
  return null;
}

function ClickPicker({ onPick }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

const SOURCE_LABEL = { exif: "foto", gps: "GPS", peta: "peta" };

function ReportForm({ onSubmit }) {
  const [photoPreview, setPhotoPreview] = useState("");
  // Salinan permanen foto untuk laporan. Pratinjau memakai blob URL yang boleh
  // dicabut kapan saja; data URL ini yang dikirim agar gambar tidak mati
  // setelah form di-reset.
  const [photoDataUrl, setPhotoDataUrl] = useState("");
  // File asli untuk upload Storage saat backend aktif (lihat api.createReport).
  // Mode demo memakai photoDataUrl di atas.
  const [photoFile, setPhotoFile] = useState(null);
  const [photoName, setPhotoName] = useState("");
  const [photoMsg, setPhotoMsg] = useState(null); // { kind: "ok"|"warn"|"error", text }
  const [location, setLocation] = useState(null); // { lat, lng, source }
  const [locating, setLocating] = useState(false);
  const [locMsg, setLocMsg] = useState(null);
  const [takenAt, setTakenAt] = useState(() => new Date().toISOString());
  const [wasteType, setWasteType] = useState(null);
  const [wasteAmount, setWasteAmount] = useState(null);
  const [severity, setSeverity] = useState(null);
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState("");
  const mapRef = useRef(null);
  const previewRef = useRef("");
  const errorRef = useRef(null);

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  // Dekatkan fokus ke pesan error agar pengguna HP tidak perlu mencari field yang salah.
  useEffect(() => {
    if (!formError || !errorRef.current) return;
    errorRef.current.focus({ preventScroll: true });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    errorRef.current.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }, [formError]);

  const beach = useMemo(
    () => (location ? nearestBeach(location.lat, location.lng) : "-"),
    [location]
  );

  function setPreview(url) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setPhotoPreview(url);
  }

  function clearPhoto() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = "";
    setPhotoPreview("");
    setPhotoDataUrl("");
    setPhotoFile(null);
    setPhotoName("");
    setPhotoMsg(null);
  }

  function resetForm() {
    clearPhoto();
    setLocation(null);
    setLocMsg(null);
    setTakenAt(new Date().toISOString());
    setWasteType(null);
    setWasteAmount(null);
    setSeverity(null);
    setNote("");
    setFormError("");
  }

  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    setPhotoMsg(null);
    if (!file) return;
    const fileError = validateImageFile(file);
    if (fileError) {
      setPhotoMsg({ kind: "error", text: fileError });
      return;
    }
    setPreview(URL.createObjectURL(file));
    setPhotoFile(file);
    setPhotoName(file.name);
    try {
      setPhotoDataUrl(await readFileAsDataURL(file));
    } catch {
      setPhotoDataUrl("");
    }
    // Baca EXIF: GPS untuk lokasi, DateTimeOriginal untuk waktu pengambilan.
    try {
      const gps = await exifr.gps(file);
      let taken = null;
      try {
        const parsed = await exifr.parse(file, ["DateTimeOriginal"]);
        if (parsed?.DateTimeOriginal instanceof Date && !Number.isNaN(parsed.DateTimeOriginal)) {
          taken = parsed.DateTimeOriginal.toISOString();
        }
      } catch {
        taken = null;
      }
      if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
        setLocation({ lat: gps.latitude, lng: gps.longitude, source: "exif" });
        if (taken) setTakenAt(taken);
        flyToPoint(mapRef.current, gps.latitude, gps.longitude);
        setPhotoMsg({
          kind: "ok",
          text: `Lokasi terisi otomatis dari foto${taken ? " beserta waktu pengambilan" : ""}. Periksa di peta mini.`,
        });
        setLocMsg(null);
      } else {
        setPhotoMsg({
          kind: "warn",
          text: "Foto tidak mengandung lokasi. Aktifkan geotag di pengaturan kamera sebelum memotret, atau tekan “Pakai lokasi saya”, atau ketuk peta mini.",
        });
      }
    } catch {
      setPhotoMsg({
        kind: "warn",
        text: "Data foto tidak bisa dibaca. Coba foto lain, atau tekan “Pakai lokasi saya”, atau ketuk peta mini.",
      });
    }
  }

  function handleUseGps() {
    if (!("geolocation" in navigator)) {
      setLocMsg({
        kind: "error",
        text: "Perangkat tidak mendukung GPS. Ketuk peta mini untuk memilih lokasi manual.",
      });
      return;
    }
    setLocating(true);
    setLocMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setLocation({ lat: latitude, lng: longitude, source: "gps" });
        flyToPoint(mapRef.current, latitude, longitude);
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setLocMsg({
            kind: "error",
            text: "Izin lokasi ditolak. Aktifkan izin lokasi untuk situs ini di pengaturan browser, lalu coba lagi — atau ketuk peta mini.",
          });
        } else if (err.code === err.TIMEOUT) {
          setLocMsg({
            kind: "error",
            text: "Pengambilan lokasi habis waktu. Coba lagi di tempat terbuka, atau ketuk peta mini.",
          });
        } else {
          setLocMsg({
            kind: "error",
            text: "Lokasi tidak tersedia. Coba lagi, atau ketuk peta mini untuk memilih manual.",
          });
        }
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function handlePick(lat, lng) {
    setLocation({ lat, lng, source: "peta" });
    setLocMsg(null);
    setFormError("");
  }

  // Pilih pantai dari daftar: isi titik ke koordinat pantai itu (sumber "peta")
  // sehingga bisa melapor walau sedang tidak di lokasi.
  function handlePickBeach(name) {
    if (!name) return;
    const beach = BEACHES.find((b) => b.name === name);
    if (!beach) return;
    setLocation({ lat: beach.lat, lng: beach.lng, source: "peta" });
    flyToPoint(mapRef.current, beach.lat, beach.lng);
    setLocMsg(null);
    setFormError("");
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!photoDataUrl && !photoFile) {
      setFormError(
        "Lampirkan foto kondisi pantai dulu — laporan tanpa foto tidak bisa dikirim agar tidak ada laporan palsu."
      );
      return;
    }
    if (!location) {
      setFormError(
        "Tentukan lokasi laporan dulu: pakai foto bergeotag, tekan “Pakai lokasi saya”, atau ketuk peta mini."
      );
      return;
    }
    if (!wasteType) {
      setFormError("Pilih tipe sampah dulu (mis. Botol Plastik, Jaring Ikan, …).");
      return;
    }
    if (!wasteAmount) {
      setFormError("Pilih jumlah sampah dulu: Kecil, Sedang, atau Besar.");
      return;
    }
    if (!severity) {
      setFormError("Pilih tingkat keparahan 1 sampai 4.");
      return;
    }
    if (!note.trim()) {
      setFormError("Isi catatan dulu: jelaskan titik sampahnya agar mudah dibedakan dari laporan lain (mis. sisi selatan, dekat muara).");
      return;
    }
    // TODO(backend): kirim laporan ke API di sini, lalu pakai respons server.
    onSubmit({
      beach,
      lat: location.lat,
      lng: location.lng,
      severity,
      type: "sampah",
      wasteType,
      wasteAmount,
      note: note.trim(),
      photo: photoDataUrl,
      photoFile,
      takenAt,
      source: location.source,
    });
    resetForm();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mx-auto w-full max-w-2xl">
      <h2 className="font-display text-lg font-bold dark:text-foam">Lapor kondisi pantai</h2>
      <p className="mt-1 text-sm dark:text-foam/90">Isi dari atas ke bawah. Foto dan lokasi wajib terisi.</p>

      {/* 1. Foto (wajib) */}
      <div className="mt-4">
        <label htmlFor="foto" className="block text-sm font-bold dark:text-foam">
          Foto (wajib)
        </label>
        <input
          id="foto"
          type="file"
          accept="image/*"
          onChange={handlePhoto}
          className="mt-1 block min-h-[48px] w-full rounded-xl border border-tide/20 bg-white dark:bg-slate-700 dark:text-foam dark:border-foam/30 px-4 py-3 text-base placeholder:text-tide/60 dark:placeholder:text-foam/60"
        />
        <p className="mt-1 text-sm text-tide dark:text-foam">
          Foto wajib dilampirkan sebagai bukti. Foto bergeotag mengisi lokasi otomatis. {photoName ? `Dipilih: ${photoName}.` : ""}
        </p>
        {photoPreview && (
          <div>
            <img
              src={photoPreview}
              alt="Pratinjau foto laporan"
              className="mt-2 max-h-96 w-full rounded-xl border border-tide/10 dark:border-foam/20 bg-foam dark:bg-slate-900 object-contain"
            />
            <button
              type="button"
              onClick={clearPhoto}
              className="mt-2 min-h-[44px] rounded-full border border-tide/20 dark:border-foam/30 px-5 text-sm font-semibold text-tide dark:text-foam hover:bg-tide/10 dark:hover:bg-foam/10"
            >
              Hapus foto
            </button>
          </div>
        )}
        {photoMsg && (
          <p
            role={photoMsg.kind === "error" ? "alert" : "status"}
            className={`mt-2 rounded-xl px-3 py-2 text-sm font-semibold ${
              photoMsg.kind === "ok" ? "bg-sev-1/10 text-sev-1 dark:bg-sev-1/20 dark:text-sev-1" : photoMsg.kind === "warn" ? "bg-sev-3/15 text-sev-3 dark:bg-sev-3/20 dark:text-sev-3" : "bg-sev-4/10 text-ember dark:bg-sev-4/20 dark:text-sev-4"
            }`}
          >
            {photoMsg.text}
          </p>
        )}
      </div>

      {/* 2. Lokasi */}
      <div className="mt-4">
        <p className="text-sm font-bold dark:text-foam">Lokasi</p>
        <button
          type="button"
          onClick={handleUseGps}
          disabled={locating}
          className="mt-1 min-h-[48px] w-full rounded-xl bg-tide dark:bg-foam px-5 text-base font-semibold text-white dark:text-tide disabled:opacity-60"
        >
          {locating ? "Mencari lokasi…" : "Pakai lokasi saya"}
        </button>
        <p className="mt-1 text-sm dark:text-foam/90">Atau pilih pantai dari daftar, atau ketuk peta mini.</p>
        <div className="mt-2">
          <label htmlFor="pilih-pantai" className="block text-sm font-bold dark:text-foam">
            Pilih pantai
          </label>
          <select
            id="pilih-pantai"
            value=""
            onChange={(e) => handlePickBeach(e.target.value)}
            className="mt-1 block min-h-[48px] w-full rounded-xl border border-tide/20 bg-white dark:bg-slate-700 dark:text-foam dark:border-foam/30 px-4 py-3 text-base placeholder:text-tide/60 dark:placeholder:text-foam/60"
          >
            <option value="">Pilih pantai…</option>
            {BEACHES.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-2 overflow-hidden rounded-xl border border-tide/15 dark:border-foam/20">
          <MapContainer
            center={MINI_CENTER}
            zoom={11}
            scrollWheelZoom
            className="z-0 h-64 w-full"
            aria-label="Peta mini pemilih lokasi laporan. Geser untuk menjelajah, scroll atau cubit untuk zoom, ketuk untuk memilih titik."
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapHandle onReady={(map) => { mapRef.current = map; }} />
            <ClickPicker onPick={handlePick} />
            {location && (
              <Marker
                position={[location.lat, location.lng]}
                icon={PICK_ICON}
                zIndexOffset={100}
              />
            )}
          </MapContainer>
        </div>
        {location ? (
          <p className="mt-2 text-sm text-tide dark:text-foam">
            Titik: {location.lat.toFixed(5)}, {location.lng.toFixed(5)} (dari {SOURCE_LABEL[location.source]}) ·
            Pantai: <strong>{beach}</strong>
          </p>
        ) : (
          <p className="mt-2 text-sm text-tide dark:text-foam">Belum ada titik. Lokasi wajib diisi sebelum mengirim.</p>
        )}
        {locMsg && (
          <p role="alert" className="mt-2 rounded-xl bg-sev-4/10 text-ember dark:bg-sev-4/20 dark:text-sev-4 px-3 py-2 text-sm font-semibold">
            {locMsg.text}
          </p>
        )}
      </div>

      {/* 3. Tipe sampah */}
      <fieldset className="mt-5">
        <legend className="text-sm font-bold dark:text-foam">Tipe sampah</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Object.entries(WASTE_TYPES).map(([value, meta]) => {
            const active = wasteType === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => { setWasteType(value); setFormError(""); }}
                className={`flex min-h-[88px] flex-col items-center justify-center gap-1 rounded-xl border px-3 py-3 text-center ${
                  active ? "border-tide dark:border-foam bg-foam dark:bg-slate-900" : "border-tide/20 dark:border-foam/30 bg-white dark:bg-slate-700"
                }`}
              >
                <span aria-hidden="true" className="text-2xl leading-none">{meta.icon}</span>
                <span className="text-sm font-bold leading-tight text-tide dark:text-foam">{meta.label}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* 4. Jumlah sampah */}
      <fieldset className="mt-5">
        <legend className="text-sm font-bold dark:text-foam">Jumlah sampah</legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {Object.entries(WASTE_AMOUNTS).map(([value, meta]) => {
            const active = wasteAmount === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => { setWasteAmount(value); setFormError(""); }}
                className={`flex min-h-[104px] flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-3 text-center ${
                  active ? "border-tide dark:border-foam bg-foam dark:bg-slate-900" : "border-tide/20 dark:border-foam/30 bg-white dark:bg-slate-700"
                }`}
              >
                <span aria-hidden="true" className="text-2xl font-bold leading-none">{meta.short}</span>
                <span className="text-sm font-bold leading-tight text-tide dark:text-foam">{meta.label}</span>
                <span className="text-xs text-tide/70 dark:text-foam/70">{meta.hint}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* 5. Keparahan */}
      <fieldset className="mt-5">
        <legend className="text-sm font-bold dark:text-foam">Tingkat keparahan</legend>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={severity === n}
              onClick={() => { setSeverity(n); setFormError(""); }}
              className={`flex min-h-[88px] flex-col items-start gap-1 rounded-xl border px-3 py-2 text-left ${
                severity === n ? "border-tide dark:border-foam bg-foam dark:bg-slate-900" : "border-tide/20 dark:border-foam/30 bg-white dark:bg-slate-700"
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                  style={{
                    backgroundColor: SEVERITY[n].color,
                    color: n === 2 || n === 3 ? "#0b3b4a" : "#ffffff",
                  }}
                >
                  {n}
                </span>
                <span className="text-sm font-bold text-tide dark:text-foam">{SEVERITY[n].label}</span>
              </span>
              <span className="text-xs text-tide/70 dark:text-foam/70">{SEVERITY[n].hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {/* 6. Catatan (wajib untuk semua laporan agar tiap titik mudah dibedakan) */}
      <div className="mt-5">
        <label htmlFor="catatan" className="block text-sm font-bold dark:text-foam">
          Catatan (wajib)
        </label>
        <textarea
          id="catatan"
          rows={3}
          value={note}
          onChange={(e) => { setNote(e.target.value); setFormError(""); }}
          placeholder="Contoh: sampah plastik di sisi selatan, sekitar 50 meter."
          aria-required="true"
          className="mt-1 block w-full rounded-xl border border-tide/20 bg-white dark:bg-slate-700 dark:text-foam dark:border-foam/30 px-4 py-3 text-base placeholder:text-tide/60 dark:placeholder:text-foam/60"
        />
      </div>

      {formError && (
        <p
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="mt-4 rounded-xl bg-sev-4/10 text-ember dark:bg-sev-4/20 dark:text-sev-4 px-4 py-3 text-sm font-semibold"
        >
          {formError}
        </p>
      )}

      <button
        type="submit"
        className="mt-4 min-h-[52px] w-full rounded-xl bg-tide dark:bg-foam text-base font-bold text-white dark:text-tide"
      >
        Kirim laporan
      </button>
    </form>
  );
}

export default ReportForm;
