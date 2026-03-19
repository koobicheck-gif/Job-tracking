import { useState, useMemo, useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl:       "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:     "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

const NAVY = "#1B2D4F";
const RED  = "#C0392B";
const BLUE = "#1E5FA8";

const JOB_TYPES = ["Pipe Boot","Shingle Repair","Final Report","Flashing","Valley Repair","Ridge Cap","Full Repair","Other"];
const STATUSES  = ["Pending","Accepted","Scheduled","Completed","Declined"];

const STATUS_STYLE = {
  Pending:   { badge: "bg-amber-50 text-amber-800 border border-amber-300",       bar: "#F59E0B" },
  Accepted:  { badge: "bg-blue-50 text-blue-800 border border-blue-300",           bar: BLUE     },
  Scheduled: { badge: "bg-purple-50 text-purple-800 border border-purple-300",     bar: "#7C3AED" },
  Completed: { badge: "bg-emerald-50 text-emerald-800 border border-emerald-300",  bar: "#059669" },
  Declined:  { badge: "bg-red-50 text-red-700 border border-red-300",              bar: RED      },
};

const JOB_KEYWORDS = [
  ["Final Report",  ["final report","roof final","final"]],
  ["Pipe Boot",     ["pipe boot"]],
  ["Shingle Repair",["shingle repair"]],
  ["Flashing",      ["flashing"]],
  ["Valley Repair", ["valley repair","valley"]],
  ["Ridge Cap",     ["ridge cap","ridge"]],
  ["Full Repair",   ["full repair"]],
];

function parseJobBlock(block, idOffset = 0) {
  const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
  const job = {
    id: Date.now() + idOffset,
    address: "", jobType: "", pitch: "", shingle: "",
    shingleColor: "", shingleType: "", pay: "", roofer: "", notes: "",
    status: "Pending", raw: block,
  };
  lines.forEach((line, i) => {
    const cleaned = line.replace(/^[-•*]\s*/, "").trim();
    const l = cleaned.toLowerCase();
    if (i === 0) { job.address = cleaned; return; }
    const payMatch = line.match(/\$[\d,]+(\.\d{2})?/);
    if (payMatch) { job.pay = payMatch[0]; return; }
    if (l.includes("story") || l.includes("pitch")) { job.pitch = cleaned; return; }
    if (/^(roofer|from|sent by)[:\s]/i.test(l)) {
      job.roofer = cleaned.replace(/^(roofer|from|sent by)[:\s]*/i, "").trim(); return;
    }
    if (/^notes?[:\s]/i.test(l)) { job.notes = cleaned.replace(/^notes?[:\s]*/i, "").trim(); return; }
    let matched = false;
    for (const [type, keywords] of JOB_KEYWORDS) {
      if (keywords.some(kw => l.includes(kw))) { job.jobType = type; matched = true; break; }
    }
    if (matched) return;
    if (!job.shingle) {
      job.shingle = cleaned;
      const parts = cleaned.split(" ");
      job.shingleType  = parts[0];
      job.shingleColor = parts.slice(1).join(" ");
    }
  });
  return job;
}

function parseMultipleJobs(rawText) {
  const lines = rawText.split("\n");
  const chunks = [];
  let current = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^\d+\s+\w/.test(t) && current.length > 0) { chunks.push(current.join("\n")); current = [t]; }
    else current.push(t);
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  const blocks = chunks.length > 0 ? chunks : [rawText.trim()];
  return blocks.filter(Boolean).map((block, i) => parseJobBlock(block, i));
}

function FitBounds({ positions }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 1) map.fitBounds(positions, { padding: [50, 50] });
    else if (positions.length === 1) map.setView(positions[0], 13);
  }, [positions.length]); // eslint-disable-line
  return null;
}

function MapView({ jobs }) {
  const [coords, setCoords] = useState(() => {
    try { return JSON.parse(localStorage.getItem("geocodeCache") || "{}"); } catch { return {}; }
  });
  const queueRef = useRef([]), runningRef = useRef(false);

  async function drainQueue() {
    if (runningRef.current) return;
    runningRef.current = true;
    while (queueRef.current.length > 0) {
      const { address } = queueRef.current.shift();
      try {
        const res  = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`);
        const data = await res.json();
        if (data[0]) {
          const coord = [parseFloat(data[0].lat), parseFloat(data[0].lon)];
          setCoords(prev => {
            const next = { ...prev, [address]: coord };
            try { localStorage.setItem("geocodeCache", JSON.stringify(next)); } catch {}
            return next;
          });
        }
      } catch {}
      await new Promise(r => setTimeout(r, 1150));
    }
    runningRef.current = false;
  }

  useEffect(() => {
    jobs.forEach(job => {
      if (!job.address || coords[job.address]) return;
      if (!queueRef.current.some(q => q.address === job.address))
        queueRef.current.push({ address: job.address });
    });
    drainQueue();
  }, [jobs]); // eslint-disable-line

  const mappedJobs = jobs.filter(j => j.address && coords[j.address]);
  const positions  = mappedJobs.map(j => coords[j.address]);
  const pending    = jobs.filter(j => j.address && !coords[j.address]).length;

  return (
    <div>
      <div className="rounded-xl overflow-hidden shadow-inner" style={{ height: "calc(100vh - 260px)", minHeight: 300 }}>
        <MapContainer center={[35.55, -97.5]} zoom={8} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds positions={positions} />
          {mappedJobs.map(job => (
            <Marker key={job.id} position={coords[job.address]}>
              <Popup>
                <div style={{ fontSize: 13, lineHeight: "1.6", minWidth: 160 }}>
                  <strong>{job.address}</strong><br />
                  {job.status}{job.pay ? ` · ${job.pay}` : ""}<br />
                  {job.jobType && <>{job.jobType}<br /></>}
                  {job.shingle && <>{job.shingle}</>}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      {pending > 0 && <p className="text-xs text-gray-400 text-center pt-2">Locating {pending} address{pending !== 1 ? "es" : ""}…</p>}
      {jobs.length === 0 && <p className="text-sm text-gray-400 text-center pt-8">No active jobs to map.</p>}
    </div>
  );
}

function JobCard({ job, onUpdate, onDelete }) {
  const [editing,    setEditing]    = useState(false);
  const [form,       setForm]       = useState(job);
  const [editingPay, setEditingPay] = useState(false);
  const [payDraft,   setPayDraft]   = useState(job.pay);

  const save = () => { onUpdate(form); setEditing(false); };
  const f    = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const commitPay = () => {
    const raw = payDraft.trim();
    onUpdate({ ...job, pay: raw && !raw.startsWith("$") ? `$${raw}` : raw });
    setEditingPay(false);
  };

  const st = STATUS_STYLE[job.status] || STATUS_STYLE.Pending;

  return (
    <div className="bg-white rounded-2xl shadow-sm mb-3 overflow-hidden active:shadow-md transition-shadow"
         style={{ borderLeft: `4px solid ${st.bar}` }}>
      <div className="px-4 pt-4 pb-3">
        {/* Address + actions row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {editing ? (
              <input
                className="font-bold text-gray-900 border-b-2 w-full mb-1 outline-none text-base bg-transparent"
                style={{ borderColor: NAVY }}
                value={form.address}
                onChange={e => f("address", e.target.value)}
                placeholder="Address"
              />
            ) : (
              <p className="font-bold text-gray-900 text-sm leading-snug">{job.address || <em className="text-gray-400">No address</em>}</p>
            )}

            {/* Badges */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${st.badge}`}>{job.status}</span>
              {job.jobType && (
                <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-indigo-50 text-indigo-800 border border-indigo-200">{job.jobType}</span>
              )}

              {/* Inline pay editor */}
              {editingPay ? (
                <span className="flex items-center gap-1 bg-emerald-50 border border-emerald-300 rounded-full px-2.5 py-0.5">
                  <span className="text-xs text-emerald-600 font-bold">$</span>
                  <input
                    autoFocus
                    className="text-xs w-16 bg-transparent outline-none text-emerald-800 font-semibold"
                    value={payDraft.replace(/^\$/, "")}
                    onChange={e => setPayDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") commitPay(); if (e.key === "Escape") setEditingPay(false); }}
                  />
                  <button onClick={commitPay}                    className="text-emerald-600 font-bold text-sm leading-none px-0.5">✓</button>
                  <button onClick={() => setEditingPay(false)}  className="text-gray-400 text-sm leading-none px-0.5">✕</button>
                </span>
              ) : (
                <button
                  onClick={() => { setPayDraft(job.pay || ""); setEditingPay(true); }}
                  title="Tap to edit price"
                  className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 active:bg-emerald-100"
                >
                  {job.pay || <em className="text-emerald-400 not-italic">+ price</em>}
                </button>
              )}

              {job.roofer && (
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">📤 {job.roofer}</span>
              )}
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={() => editing ? save() : setEditing(true)}
              className="text-xs px-3 py-2 rounded-xl font-bold min-w-[52px] active:opacity-80"
              style={editing ? { background: NAVY, color: "white" } : { background: "#EEF2FF", color: NAVY }}
            >
              {editing ? "Save" : "Edit"}
            </button>
            <button
              onClick={() => onDelete(job.id)}
              className="text-xs px-3 py-2 rounded-xl font-bold active:opacity-80"
              style={{ background: "#FEE2E2", color: RED }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Edit form */}
        {editing && (
          <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-2 text-sm">
            {[["Roofer","roofer"],["Pay","pay"],["Shingle","shingle"],["Pitch / Stories","pitch"]].map(([label, key]) => (
              <div key={key}>
                <label className="text-xs font-bold block mb-0.5" style={{ color: NAVY }}>{label}</label>
                <input
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 bg-gray-50"
                  value={form[key]}
                  onChange={e => f(key, e.target.value)}
                />
              </div>
            ))}
            <div>
              <label className="text-xs font-bold block mb-0.5" style={{ color: NAVY }}>Job Type</label>
              <select className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 bg-gray-50"
                value={form.jobType} onChange={e => f("jobType", e.target.value)}>
                <option value="">-- Select --</option>
                {JOB_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold block mb-0.5" style={{ color: NAVY }}>Status</label>
              <select className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 bg-gray-50"
                value={form.status} onChange={e => f("status", e.target.value)}>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-bold block mb-0.5" style={{ color: NAVY }}>Notes</label>
              <textarea
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 resize-none bg-gray-50"
                rows={2} value={form.notes} onChange={e => f("notes", e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Detail row */}
        {!editing && (job.shingle || job.pitch || job.notes) && (
          <div className="mt-2 pt-2 border-t border-gray-50 text-xs text-gray-500 space-y-0.5">
            {job.shingle && <p><span className="font-semibold text-gray-700">Shingle:</span> {job.shingle}</p>}
            {job.pitch   && <p><span className="font-semibold text-gray-700">Pitch:</span> {job.pitch}</p>}
            {job.notes   && <p><span className="font-semibold text-gray-700">Notes:</span> {job.notes}</p>}
          </div>
        )}
      </div>

      {/* Footer: quick status */}
      {!editing && (
        <div className="px-4 pb-3">
          <select
            className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-gray-50 outline-none w-full sm:w-auto"
            value={job.status}
            onChange={e => onUpdate({ ...job, status: e.target.value })}
          >
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

// ─── Bottom nav icon components ───────────────────────────────────────────────
function IconDashboard({ active }) {
  const c = active ? "white" : "#9CA3AF";
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="8" height="8" rx="2" fill={c}/>
      <rect x="13" y="3" width="8" height="8" rx="2" fill={c} opacity="0.7"/>
      <rect x="3" y="13" width="8" height="8" rx="2" fill={c} opacity="0.7"/>
      <rect x="13" y="13" width="8" height="8" rx="2" fill={c} opacity="0.5"/>
    </svg>
  );
}
function IconMap({ active }) {
  const c = active ? "white" : "#9CA3AF";
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill={c}/>
      <circle cx="12" cy="9" r="2.5" fill={active ? NAVY : "#E5E7EB"}/>
    </svg>
  );
}
function IconAdd({ active }) {
  const c = active ? "white" : "#9CA3AF";
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" fill={active ? "rgba(255,255,255,0.2)" : "none"} stroke={c} strokeWidth="2"/>
      <path d="M12 7v10M7 12h10" stroke={c} strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
}

export default function App() {
  const [jobs, setJobs] = useState(() => {
    try { return JSON.parse(localStorage.getItem("jobs") || "[]"); } catch { return []; }
  });
  const [rawText,      setRawText]      = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterRoofer, setFilterRoofer] = useState("All");
  const [tab,          setTab]          = useState("dashboard");

  useEffect(() => {
    try { localStorage.setItem("jobs", JSON.stringify(jobs)); } catch {}
  }, [jobs]);

  const addJobs = () => {
    if (!rawText.trim()) return;
    setJobs(prev => [...parseMultipleJobs(rawText), ...prev]);
    setRawText("");
    setTab("dashboard");
  };

  const updateJob = (u) => setJobs(prev => prev.map(j => j.id === u.id ? u : j));
  const deleteJob = (id) => setJobs(prev => prev.filter(j => j.id !== id));

  const roofers = useMemo(() => ["All", ...new Set(jobs.map(j => j.roofer).filter(Boolean))], [jobs]);

  const filtered = jobs.filter(j => {
    if (filterStatus !== "All" && j.status !== filterStatus) return false;
    if (filterRoofer !== "All" && j.roofer !== filterRoofer) return false;
    return true;
  });

  const totalRevenue = jobs
    .filter(j => ["Accepted","Scheduled","Completed"].includes(j.status))
    .reduce((s, j) => { const n = parseFloat((j.pay||"").replace(/[$,]/g,"")); return s + (isNaN(n)?0:n); }, 0);

  const completedCount = jobs.filter(j => j.status === "Completed").length;
  const pendingCount   = jobs.filter(j => j.status === "Pending").length;

  const TABS = [
    { key: "dashboard", label: "Jobs",    Icon: IconDashboard },
    { key: "map",       label: "Map",     Icon: IconMap       },
    { key: "add",       label: "Add Job", Icon: IconAdd       },
  ];

  return (
    <div className="min-h-screen font-sans select-none" style={{ background: "#EEF3FB" }}>

      {/* Faint watermark */}
      <div className="fixed inset-0 pointer-events-none" style={{
        backgroundImage: "url('/logo.svg')",
        backgroundSize: "360px",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        opacity: 0.03,
      }} />

      {/* ── Sticky Header ── */}
      <header className="sticky top-0 z-40" style={{ background: `linear-gradient(135deg, ${NAVY} 0%, #243F6B 100%)` }}>
        <div className="flex items-center gap-3 px-4 py-3 max-w-2xl mx-auto">
          {/* Logo in top-left corner */}
          <img
            src="/logo.svg"
            alt="Roof Repair Partners"
            className="h-11 w-11 shrink-0 object-contain drop-shadow"
            style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.4))" }}
          />
          <div className="leading-tight">
            <h1 className="text-white font-black text-base sm:text-lg tracking-wide leading-none">
              Roof Repair Partners
            </h1>
            <p className="text-blue-300 text-xs font-medium tracking-widest uppercase mt-0.5">Job Tracker</p>
          </div>
          <div className="ml-auto shrink-0">
            <span className="text-white text-xs font-bold bg-white/15 px-3 py-1.5 rounded-full">
              {jobs.length} Job{jobs.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
        {/* Brand red accent bar */}
        <div style={{ background: RED, height: 3 }} />
      </header>

      {/* ── Scrollable content ── */}
      <div className="max-w-2xl mx-auto px-3 sm:px-4 pt-4 pb-28">

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-2 sm:gap-3 mb-4">
          {[
            { label: "Total",     value: jobs.length,                              bg: NAVY,      sub: "text-blue-300"   },
            { label: "Pending",   value: pendingCount,                             bg: BLUE,      sub: "text-blue-200"   },
            { label: "Done",      value: completedCount,                           bg: "#059669", sub: "text-emerald-200"},
            { label: "Revenue",   value: `$${totalRevenue.toLocaleString()}`,      bg: RED,       sub: "text-red-200",  small: true },
          ].map(({ label, value, bg, sub, small }) => (
            <div key={label} className="rounded-2xl p-2.5 sm:p-3 text-center shadow-lg" style={{ background: bg }}>
              <p className={`font-black text-white leading-tight ${small ? "text-base sm:text-lg" : "text-2xl sm:text-3xl"}`}>{value}</p>
              <p className={`text-xs font-semibold mt-0.5 ${sub}`}>{label}</p>
            </div>
          ))}
        </div>

        {/* ── Desktop tab bar (hidden on small screens) ── */}
        <div className="hidden sm:flex gap-1 mb-5 bg-white rounded-2xl p-1.5 shadow-md border border-gray-100">
          {TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className="flex-1 py-2 text-sm font-bold rounded-xl transition-all"
              style={tab === key ? { background: NAVY, color: "white", boxShadow: "0 2px 8px rgba(27,45,79,0.35)" } : { color: "#6B7280" }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Add Jobs Tab ── */}
        {tab === "add" && (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-5 rounded-full" style={{ background: RED }} />
              <p className="text-sm font-black" style={{ color: NAVY }}>Paste Job Text</p>
            </div>
            <p className="text-xs text-gray-400 mb-3">Each address line starts a new job. Bullets fill in details automatically.</p>
            <textarea
              className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm h-44 resize-none focus:outline-none focus:ring-2 font-mono bg-gray-50"
              placeholder={"12016 NW 120th St. Yukon, OK 73099\n- Roof Final & Paint PVC Pipes\n- 1 story, 7 pitch\n- Prolam Weathered Wood\n- $75"}
              value={rawText}
              onChange={e => setRawText(e.target.value)}
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={addJobs}
                className="flex-1 text-white rounded-xl py-3 text-sm font-black shadow-md active:opacity-80"
                style={{ background: `linear-gradient(135deg, ${NAVY}, ${BLUE})` }}
              >
                Parse &amp; Add Jobs
              </button>
              <button onClick={() => setRawText("")}
                className="px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-500 active:bg-gray-100 font-semibold">
                Clear
              </button>
            </div>
          </div>
        )}

        {/* ── Map Tab ── */}
        {tab === "map" && (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3" style={{ background: NAVY }}>
              <div className="w-1 h-4 rounded-full bg-white/40" />
              <p className="text-sm font-black text-white">Active Job Map</p>
            </div>
            <div className="p-3 sm:p-4">
              <MapView jobs={jobs.filter(j => ["Accepted","Scheduled","Completed"].includes(j.status))} />
            </div>
          </div>
        )}

        {/* ── Dashboard Tab ── */}
        {tab === "dashboard" && (
          <>
            {/* Filters */}
            <div className="flex gap-2 mb-3">
              <select
                className="text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white flex-1 outline-none shadow-sm font-semibold text-gray-700"
                value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              >
                <option value="All">All Statuses</option>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
              {roofers.length > 1 && (
                <select
                  className="text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white flex-1 outline-none shadow-sm font-semibold text-gray-700"
                  value={filterRoofer} onChange={e => setFilterRoofer(e.target.value)}
                >
                  {roofers.map(r => <option key={r}>{r}</option>)}
                </select>
              )}
            </div>

            {filtered.length > 0 && (
              <p className="text-xs text-gray-400 mb-3 font-semibold">
                {filtered.length} job{filtered.length !== 1 ? "s" : ""} shown
              </p>
            )}

            {filtered.length === 0 ? (
              <div className="text-center py-16">
                <img src="/logo.svg" alt="RRP" className="h-20 w-20 mx-auto mb-4 opacity-20" />
                <p className="text-gray-600 font-bold">No jobs yet.</p>
                <p className="text-gray-400 text-sm mt-1">Tap "Add Job" below to get started.</p>
                <button
                  onClick={() => setTab("add")}
                  className="mt-4 text-sm font-black px-6 py-3 rounded-xl text-white shadow-lg active:opacity-80"
                  style={{ background: `linear-gradient(135deg, ${RED}, #E74C3C)` }}
                >
                  Add Your First Job
                </button>
              </div>
            ) : (
              filtered.map(job => <JobCard key={job.id} job={job} onUpdate={updateJob} onDelete={deleteJob} />)
            )}
          </>
        )}
      </div>

      {/* ── Fixed bottom nav (mobile) ── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 sm:hidden"
        style={{
          background: `linear-gradient(180deg, ${NAVY} 0%, #111E35 100%)`,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          boxShadow: "0 -4px 20px rgba(0,0,0,0.3)",
        }}
      >
        {/* Red top accent */}
        <div style={{ background: RED, height: 2 }} />
        <div className="flex">
          {TABS.map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-all active:opacity-70"
              style={{ minHeight: 56 }}
            >
              <Icon active={tab === key} />
              <span
                className="text-xs font-bold leading-none"
                style={{ color: tab === key ? "white" : "#6B7280" }}
              >
                {label}
              </span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
