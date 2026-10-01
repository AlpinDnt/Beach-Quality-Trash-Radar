import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { BEACHES, REPORT_TYPES, SEVERITY, WASTE_AMOUNTS, WASTE_TYPES } from "./data.js";
import { beachCenters, timeAgo } from "./utils.js";

// Label ringkas laporan sampah: "Botol Plastik · Sedang".
// Kompatibel mundur dengan laporan lama tanpa wasteType/wasteAmount.
function wasteLabel(r) {
  const t = WASTE_TYPES[r.wasteType]?.label ?? (REPORT_TYPES[r.type] ?? r.type ?? "");
  const a = WASTE_AMOUNTS[r.wasteAmount]?.label;
  return a ? `${t} · ${a}` : t;
}

// Detail terpisah untuk popup peta agar eksplisit:
// { typeLabel, typeIcon, amountLabel, amountHint }
function wasteDetail(r) {
  const meta = WASTE_TYPES[r.wasteType];
  const amount = WASTE_AMOUNTS[r.wasteAmount];
  return {
    typeLabel: meta?.label ?? (REPORT_TYPES[r.type] ?? r.type ?? "-"),
    typeIcon: meta?.icon ?? "🗑️",
    amountLabel: amount?.label ?? "-",
    amountHint: amount?.hint ?? "",
  };
}

const BALI_CENTER = [-8.72, 115.17];
const BALI_ZOOM = 11;

// Nama pantai preset (punya koordinat resmi). Titik putih hanya digambar
// untuk pantai preset — pantai custom/"Lainnya" dari laporan tidak punya
// koordinat tetap, lokasinya dijelaskan lewat catatan tiap laporan.
const PRESET_NAMES = new Set(BEACHES.map((b) => b.name));

// Zoom tujuan saat fokus ke satu pantai (level detail jalan/pasir).
// Smart zoom: hanya dipakai untuk zoom-in, tidak pernah zoom-out paksa.
const FOCUS_ZOOM = 15;

// Batas zoom detail: dot laporan individual hanya digambar pada zoom ini
// ke atas (atau untuk pantai yang sedang dipilih). Di bawahnya tiap pantai
// hanya tampil satu dot status yang bersih agar tidak saling timpa.
const DETAIL_ZOOM = 14;

// Lapisan heatmap: radius (m) + opacity isi, digambar dari paling lebar ke paling kecil.
const HEAT_LAYERS = [
  { radius: 1000, fillOpacity: 0.2 },
  { radius: 450, fillOpacity: 0.32 },
];

// Dot berukuran piksel-tetap sebagai DivIcon (HTML), bukan CircleMarker (SVG).
// Alasan: Leaflet me-scale seluruh overlay SVG via CSS transform selama
// animasi zoom sehingga CircleMarker ikut membesar; ikon HTML Marker hanya
// digeser posisinya sehingga ukurannya konstan selama flyTo/zoom.
// className sengaja "" agar style bawaan .leaflet-div-icon (kotak putih)
// tidak ikut terpakai.
const WHITE_ICON = L.divIcon({
  className: "bq-white-wrap",
  html: '<div class="bq-dot"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const RING_ICON = L.divIcon({
  className: "",
  html: '<div class="bq-ring"></div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

// Satu ikon per severity agar identitas objek stabil (tidak dibuat ulang
// tiap render). Warna fill via inline style sesuai SEVERITY.
const REPORT_ICONS = Object.fromEntries(
  Object.entries(SEVERITY).map(([n, s]) => [
    n,
    L.divIcon({
      className: "",
      html: `<div class="bq-report" style="background-color:${s.color}"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    }),
  ])
);

const FALLBACK_REPORT_ICON = L.divIcon({
  className: "",
  html: '<div class="bq-report" style="background-color:#0b3b4a"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

function FlyToBeach({ selectedBeach, centers, cycleTarget, cycleKey }) {
  const map = useMap();
  // Kunci fokus terakhir. Mencegah flyTo berulang untuk target yang sama
  // (mis. render ulang) yang bisa memotong animasi sebelumnya dan
  // menguncinya di tengah jalan.
  const lastKey = useRef(null);
  // Pantai preset → terbang ke titik pusatnya. Pantai custom/"Lainnya" →
  // terbang ke laporan hasil cycle (cycleTarget, dihitung di MapView).
  const isCustom = !!selectedBeach && !PRESET_NAMES.has(selectedBeach);
  const center = !selectedBeach || isCustom ? null : centers[selectedBeach];
  const lat = isCustom ? cycleTarget?.lat : center?.lat;
  const lng = isCustom ? cycleTarget?.lng : center?.lng;
  const key = isCustom ? `lainnya:${cycleKey}` : `preset:${lat},${lng}`;
  useEffect(() => {
    if (!selectedBeach) {
      lastKey.current = null;
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (lastKey.current === key) return;
    lastKey.current = key;
    const currentZoom = map.getZoom();
    // Smart zoom: hanya zoom-in, tidak pernah zoom-out paksa. Untuk pantai
    // preset yang sudah terlihat detail, cukup highlight (tanpa gerak).
    // Untuk cycle pantai custom, SELALU terbang agar tiap klik berpindah
    // ke titik laporan berikutnya walau masih dalam viewport.
    if (!isCustom) {
      try {
        if (map.getBounds().contains([lat, lng]) && currentZoom >= FOCUS_ZOOM) return;
      } catch {
        // Abaikan bila bounds belum siap, lanjut ke fly di bawah.
      }
    }
    const nextZoom = Math.max(currentZoom, FOCUS_ZOOM);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      if (nextZoom !== currentZoom) {
        map.setView([lat, lng], nextZoom);
      } else {
        map.panTo([lat, lng]);
      }
    } else {
      map.flyTo([lat, lng], nextZoom, { duration: 0.8 });
    }
  }, [selectedBeach, isCustom, lat, lng, key, map]);
  return null;
}

// Saat tinggi wadah peta berubah (panel kanan lebih tinggi), beri tahu Leaflet
// agar tile area baru ikut tergambar, bukan abu-abu kosong.
// Dijaga agar TIDAK invalidate saat animasi zoom/fly berjalan — itulah yang
// membuat overlay SVG Leaflet terkunci dalam skala animasi sehingga
// CircleMarker terlihat raksasa seperti di laporan bug.
function ResizeHandler() {
  const map = useMap();
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return undefined;
    const el = map.getContainer();
    let raf = 0;
    let w = el.clientWidth;
    let h = el.clientHeight;
    const ro = new ResizeObserver(() => {
      const nw = el.clientWidth;
      const nh = el.clientHeight;
      if (nw === w && nh === h) return;
      w = nw;
      h = nh;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // Lewati saat animasi zoom/fly aktif; jadwalkan ulang setelah
        // animasi selesai agar ukuran akhir tetap diterapkan.
        if (map._animatingZoom) {
          map.once("moveend", () => map.invalidateSize());
          return;
        }
        map.invalidateSize();
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [map]);
  return null;
}

// Melaporkan level zoom peta ke state React agar lapisan dot bisa
// di-tier per zoom (lihat DETAIL_ZOOM). Dipakai sekali di dalam MapContainer.
function ZoomTracker({ onZoom }) {
  const map = useMap();
  useEffect(() => {
    onZoom(map.getZoom());
  }, [map, onZoom]);
  useMapEvents({
    zoomend(e) {
      onZoom(e.target.getZoom());
    },
  });
  return null;
}

function MapView({ reports, statuses, selectedBeach, onSelectBeach, onGoReport }) {
  // Level zoom peta saat ini (untuk tier tampilan dot, lihat DETAIL_ZOOM).
  const [mapZoom, setMapZoom] = useState(BALI_ZOOM);
  // Posisi cycle per pantai custom/"Lainnya" (sticky: diingat walau pindah
  // ke pantai lain lalu kembali). Tiap klik pada pantai custom yang sedang
  // aktif memajukan index sehingga flyTo berpindah ke laporan berikutnya.
  const [cycleIndices, setCycleIndices] = useState({});
  // Pusat tiap nama pantai berstatus: preset memakai koordinat resmi,
  // nama non-preset (mis. "Lainnya") memakai rata-rata lokasi laporannya.
  const centers = useMemo(() => {
    const avg = beachCenters(reports);
    const out = {};
    for (const name of Object.keys(statuses)) {
      const preset = BEACHES.find((b) => b.name === name);
      out[name] = preset ? { lat: preset.lat, lng: preset.lng } : avg[name];
    }
    return out;
  }, [reports, statuses]);

  // Pantai diurutkan: paling darurat dulu, tanpa data di paling bawah.
  // Nama non-preset yang punya status ikut tampil di bawah preset berstatus.
  const sortedBeaches = useMemo(() => {
    const counts = {};
    for (const r of reports) counts[r.beach] = (counts[r.beach] ?? 0) + 1;
    const presetNames = new Set(BEACHES.map((b) => b.name));
    const extras = Object.keys(statuses)
      .filter((name) => !presetNames.has(name) && centers[name])
      .map((name) => ({
        name,
        lat: centers[name].lat,
        lng: centers[name].lng,
        status: statuses[name],
        count: counts[name] ?? 0,
      }));
    return [...BEACHES.map((b) => ({
      ...b,
      status: statuses[b.name] ?? null,
      count: counts[b.name] ?? 0,
    })), ...extras].sort((a, b) => {
      if (a.status == null && b.status == null) return a.name.localeCompare(b.name, "id");
      if (a.status == null) return 1;
      if (b.status == null) return -1;
      return b.status - a.status || a.name.localeCompare(b.name, "id");
    });
  }, [reports, statuses, centers]);

  const latestReports = useMemo(() => {
    if (!selectedBeach) return [];
    return reports
      .filter((r) => r.beach === selectedBeach)
      .sort((a, b) => new Date(b.takenAt) - new Date(a.takenAt))
      .slice(0, 5);
  }, [reports, selectedBeach]);

  // Id laporan hijau (severity 1) TERBARU per pantai. Tiap pantai menampilkan
  // maksimal 1 dot hijau — termasuk di pantai berstatus Bersih sebagai bukti
  // kebersihan. Hijau lain di pantai yang sama disembunyikan agar peta tidak
  // ramai, tapi rincian semuanya tetap ada di panel status.
  const latestGreenIds = useMemo(() => {
    const latest = {};
    for (const r of reports) {
      if (r.severity !== 1) continue;
      const t = new Date(r.takenAt).getTime();
      if (Number.isNaN(t)) continue;
      if (!latest[r.beach] || t > latest[r.beach].time) {
        latest[r.beach] = { id: r.id, time: t };
      }
    }
    return new Set(Object.values(latest).map((v) => v.id));
  }, [reports]);

  // Daftar laporan per pantai custom/"Lainnya", urut terbaru dulu — SAMA
  // PERSIS dengan urutan "Tanda yang dibersihkan" di form aksi (lihat
  // dirtyReportsFor di CleanupBoard.jsx) agar konsisten. Memakai SEMUA
  // laporan (tanpa filter 72 jam) supaya semua titik bisa dijelajahi.
  const customLists = useMemo(() => {
    const out = {};
    for (const r of reports) {
      if (PRESET_NAMES.has(r.beach)) continue;
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
      (out[r.beach] ??= []).push(r);
    }
    for (const k of Object.keys(out)) {
      out[k].sort((a, b) => new Date(b.takenAt) - new Date(a.takenAt));
    }
    return out;
  }, [reports]);

  // Target cycle saat ini untuk pantai custom yang dipilih: laporan ke-i
  // dari daftar di atas. Klik berulang pada tombolnya memutar daftar ini.
  const cycleList = selectedBeach && !PRESET_NAMES.has(selectedBeach)
    ? (customLists[selectedBeach] ?? [])
    : [];
  const cyclePos = cycleList.length
    ? (((cycleIndices[selectedBeach] ?? 0) % cycleList.length) + cycleList.length) % cycleList.length
    : 0;
  const cycleTarget = cycleList[cyclePos] ?? null;
  const cycleKey = cycleTarget ? `${cycleTarget.id}:${cyclePos}` : "none";

  // Klik tombol pantai: pantai preset toggle pilih/batal seperti biasa.
  // Pantai custom yang sedang aktif dimajukan cyclenya (sticky, diingat),
  // bukan dibatalkan — tiap klik berpindah ke titik laporan berikutnya.
  function handleBeachClick(b) {
    const active = selectedBeach === b.name;
    if (active && !PRESET_NAMES.has(b.name)) {
      setCycleIndices((prev) => ({ ...prev, [b.name]: (prev[b.name] ?? 0) + 1 }));
      return;
    }
    onSelectBeach(active ? null : b.name);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_480px]">
      <div className="flex min-w-0 flex-col">
      <div className="flex-1 overflow-hidden rounded-2xl border border-tide/10 dark:border-foam/20">
        <MapContainer
          center={BALI_CENTER}
          zoom={BALI_ZOOM}
          scrollWheelZoom
          className="z-0 h-[420px] w-full lg:h-full lg:min-h-[600px]"
          aria-label="Peta kebersihan pantai Bali"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FlyToBeach
            selectedBeach={selectedBeach}
            centers={centers}
            cycleTarget={cycleTarget}
            cycleKey={cycleKey}
          />
          <ResizeHandler />
          <ZoomTracker onZoom={setMapZoom} />
          {/* Heatmap hanya untuk pantai PRESET yang bermasalah (status 2-4).
              Pantai yang sudah Bersih (1) tidak digambar agar peta ringkas —
              daftarnya tetap ada di panel status. Pantai custom/"Lainnya"
              tidak dapat heatmap karena lokasinya dinamis (rata-rata laporan
              bisa bergeser ke tengah yang bukan lokasi sebenarnya) — cukup
              dot laporan + catatan. */}
          {sortedBeaches
            .filter((b) => PRESET_NAMES.has(b.name) && b.status != null && b.status !== 1 && centers[b.name])
            .map((b) => {
              const center = centers[b.name];
              const color = SEVERITY[b.status].color;
              return HEAT_LAYERS.map((layer) => (
                <Circle
                  key={`${b.name}-${layer.radius}`}
                  center={[center.lat, center.lng]}
                  radius={layer.radius}
                  pathOptions={{
                    color,
                    fillColor: color,
                    fillOpacity: layer.fillOpacity,
                    weight: 0,
                    interactive: false,
                  }}
                />
              ));
            })}
          {/* Titik putih netral di lokasi pantai PRESET saja.
              Marker HTML (DivIcon): ukurannya konstan saat animasi zoom.
              Pantai custom/"Lainnya" dari laporan tidak dapat titik putih
              karena tidak punya koordinat tetap — lokasinya dijelaskan lewat
              catatan tiap laporan (catatan wajib untuk semua laporan).
              Sengaja di lapisan PALING ATAS (di atas dot laporan) dan tembus
              klik (lihat .bq-white-wrap) sehingga popup laporan di bawahnya
              tetap bisa diklik. */}
          {sortedBeaches
            .filter((b) => PRESET_NAMES.has(b.name) && Number.isFinite(b.lat) && Number.isFinite(b.lng))
            .map((b) => {
              return (
                <Marker
                  key={`${b.name}-pusat`}
                  position={[b.lat, b.lng]}
                  icon={WHITE_ICON}
                  interactive={false}
                  keyboard={false}
                  zIndexOffset={150}
                />
              );
            })}
          {/* Dot laporan individual.
              - Pantai custom/"Lainnya": tiap laporan SELALU dapat dot di semua
                zoom — tidak ada titik putih/heatmap, jadi dot adalah
                satu-satunya penanda lokasi (jumlah dot = jumlah laporan).
              - Pantai preset: hijau (severity 1) tampil maksimal 1 (yang
                terbaru, lihat latestGreenIds) dan SELALU digambar walau zoom
                jauh — sebagai bukti pantai sudah dibersihkan. Laporan lain
                hanya digambar saat zoom detail atau untuk pantai yang sedang
                dipilih — saat zoom out koordinat laporan (15–50 m dari titik
                pantai, < 1 px) pasti menimpa titik putih secara miring
                sehingga terlihat berantakan. Tidak ada lagi dot warna status
                yang sepusat dengan titik putih: dot berwarna di peta ini
                SEMUANYA dot laporan. Rincian semua laporan tetap ada di panel
                status. */}
          {reports.filter((r) => {
            if (!PRESET_NAMES.has(r.beach)) return true;
            const isLatestGreen = r.severity === 1 && latestGreenIds.has(r.id);
            if (isLatestGreen) return true;
            if (r.severity === 1) return false;
            return mapZoom >= DETAIL_ZOOM || r.beach === selectedBeach;
          }).map((r) => {
            // Hijau terbaru sepusat dengan titik putih (koordinat preset persis)
            // dan tetap di bawahnya (100 < 150) — titik putih di depan, hijau
            // terlihat sebagai cincin di sekelilingnya. Titik putih tembus
            // klik (.bq-white-wrap) sehingga popup hijau tetap bisa dibuka.
            return (
              <Marker
                key={r.id}
                position={[r.lat, r.lng]}
                icon={REPORT_ICONS[r.severity] ?? FALLBACK_REPORT_ICON}
                zIndexOffset={100}
              >
                <Popup>
                  <div className="text-sm">
                    <p className="font-bold">{r.beach}</p>
                    <p>
                      {SEVERITY[r.severity]?.label ?? ""} · {wasteLabel(r)} ·{" "}
                      {timeAgo(r.takenAt)}
                    </p>
                    {(() => {
                      const d = wasteDetail(r);
                      return (
                        <dl className="mt-2 space-y-1 rounded-lg bg-foam px-2.5 py-2 dark:bg-slate-700">
                          <div className="flex gap-1.5">
                            <dt className="shrink-0 font-semibold">Tipe:</dt>
                            <dd>
                              <span aria-hidden="true">{d.typeIcon} </span>
                              {d.typeLabel}
                            </dd>
                          </div>
                          <div className="flex gap-1.5">
                            <dt className="shrink-0 font-semibold">Jumlah:</dt>
                            <dd>
                              {d.amountLabel}
                              {d.amountHint ? ` (${d.amountHint})` : ""}
                            </dd>
                          </div>
                        </dl>
                      );
                    })()}
                    {r.photo && (
                      <img src={r.photo} alt={`Foto laporan di ${r.beach}`} className="mt-2 max-w-[220px] rounded-lg" />
                    )}
                    {r.note && <p className="mt-1">{r.note}</p>}
                  </div>
                </Popup>
              </Marker>
            );
          })}
          {/* Cincin penanda pantai PRESET terpilih: lingkaran di sekeliling
              titik putihnya agar jelas lokasi mana yang sedang dipilih.
              Pantai custom/"Lainnya" tidak dapat cincin (tidak punya titik
              putih) agar tidak ada garis tepi yang menggantung. */}
          {(() => {
            if (!selectedBeach || !PRESET_NAMES.has(selectedBeach)) return null;
            const sel = sortedBeaches.find((b) => b.name === selectedBeach);
            const pos = sel
              ? [sel.lat, sel.lng]
              : centers[selectedBeach]
                ? [centers[selectedBeach].lat, centers[selectedBeach].lng]
                : null;
            if (!pos || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) return null;
            return (
              <Marker
                key={`${selectedBeach}-pilih`}
                position={pos}
                icon={RING_ICON}
                interactive={false}
                keyboard={false}
                zIndexOffset={200}
              />
            );
          })()}
        </MapContainer>
      </div>
      <p className="mt-2 text-xs leading-relaxed dark:text-foam/90">
        <strong>Titik putih = lokasi pantai preset.</strong> <strong>Warna area = rata-rata 72 jam.</strong>{" "}
        <strong>Dot warna = satu laporan</strong>, warnanya sesuai tingkat keparahannya. Klik dot untuk lihat catatan dan foto lokasinya.{" "}
        {[1, 2, 3, 4].map((n, i) => (
          <span key={n}>
            {i > 0 && " · "}
            <span
              aria-hidden="true"
              className="mr-1 inline-block h-2.5 w-2.5 rounded-full ring-1 ring-black/15 dark:ring-white/20"
              style={{ backgroundColor: SEVERITY[n].color }}
            />
            {SEVERITY[n].label}
          </span>
        ))}
      </p>
      </div>

      <aside aria-label="Status pantai" className="rounded-2xl border border-tide/10 bg-white p-4 dark:border-foam/20 dark:bg-slate-800">
        <h2 className="font-display text-lg font-bold">Status pantai</h2>
        <p className="mt-1 text-sm dark:text-foam/90">Diurutkan dari yang paling darurat. Pilih pantai untuk melihat laporannya.</p>
        <ul className="mt-3 grid grid-cols-2 gap-2">
          {sortedBeaches.map((b) => {
            const active = selectedBeach === b.name;
            const label = b.status == null ? "Belum ada data" : SEVERITY[b.status].label;
            const color = b.status == null ? "#9db3ad" : SEVERITY[b.status].color;
            // Indikator posisi cycle untuk pantai custom yang dipilih:
            // "Lainnya (2/3)" = titik ke-2 dari 3 laporan.
            const isCustom = !PRESET_NAMES.has(b.name);
            const customTotal = isCustom ? (customLists[b.name] ?? []).length : 0;
            const customPos = active && customTotal
              ? ((((cycleIndices[b.name] ?? 0) % customTotal) + customTotal) % customTotal) + 1
              : 0;
            return (
              <li key={b.name}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => handleBeachClick(b)}
                  className={`flex min-h-[44px] w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-sm leading-tight ${
                    active 
                      ? "border-tide bg-foam dark:border-foam bg-foam dark:bg-slate-700" 
                      : "border-tide/15 hover:border-tide/40 dark:border-foam/20 dark:hover:border-foam/40"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 rounded-full ring-1 ring-black/15 dark:ring-white/20"
                    style={{ backgroundColor: color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {b.name}
                      {customPos > 0 ? ` (${customPos}/${customTotal})` : ""}
                    </span>
                    <span className="block text-xs dark:text-foam/75">
                      {label}
                      {b.count > 0 ? ` · ${b.count} laporan` : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 border-t border-tide/10 pt-4 dark:border-foam/20">
          {!selectedBeach && (
            <p className="text-sm text-tide/80 dark:text-foam/75">Pilih pantai di atas untuk melihat 5 laporan terbarunya.</p>
          )}
          {selectedBeach && latestReports.length === 0 && (
            <div>
              <p className="text-sm dark:text-foam/90">Belum ada laporan di {selectedBeach}.</p>
              <button
                type="button"
                onClick={onGoReport}
                className="mt-2 min-h-[44px] rounded-full bg-tide px-5 text-sm font-semibold text-white dark:bg-foam dark:text-tide"
              >
                Jadi yang pertama
              </button>
            </div>
          )}
          {selectedBeach && latestReports.length > 0 && (
            <div>
              <h3 className="text-sm font-bold dark:text-foam/95">5 laporan terbaru di {selectedBeach}</h3>
              <ul className="mt-1 divide-y divide-tide/10 border-t border-tide/10 dark:divide-foam/20 dark:border-foam/20">
                {latestReports.map((r) => (
                  <li key={r.id} className="py-2 text-sm dark:text-foam/90">
                    <p className="font-semibold">
                      {SEVERITY[r.severity]?.label} · {wasteLabel(r)} · {timeAgo(r.takenAt)}
                    </p>
                    <p className="mt-0.5 text-tide/80 dark:text-foam/70">
                      Tipe: {wasteDetail(r).typeLabel} · Jumlah: {wasteDetail(r).amountLabel}
                      {wasteDetail(r).amountHint ? ` (${wasteDetail(r).amountHint})` : ""}
                    </p>
                    {r.note && <p className="mt-0.5">{r.note}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

export default MapView;
