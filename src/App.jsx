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

// ── Design tokens ─────────────────────────────────────────────────────────────
const NAVY = "#1B2D4F";
const RED  = "#C0392B";

const STATUS_META = {
  Pending:   { color: "#F59E0B", bg: "#FFFBEB", text: "#78350F", label: "Pending"   },
  Accepted:  { color: "#3B82F6", bg: "#EFF6FF", text: "#1E3A8A", label: "Accepted"  },
  Scheduled: { color: "#8B5CF6", bg: "#F5F3FF", text: "#4C1D95", label: "Scheduled" },
  Completed: { color: "#10B981", bg: "#ECFDF5", text: "#064E3B", label: "Completed" },
  Declined:  { color: "#EF4444", bg: "#FEF2F2", text: "#7F1D1D", label: "Declined"  },
};

const JOB_TYPES = ["Pipe Boot","Shingle Repair","Final Report","Flashing","Valley Repair","Ridge Cap","Full Repair","Other"];
const STATUSES  = ["Pending","Accepted","Scheduled","Completed","Declined"];

const JOB_KEYWORDS = [
  ["Final Report",  ["final report","roof final","final"]],
  ["Pipe Boot",     ["pipe boot"]],
  ["Shingle Repair",["shingle repair"]],
  ["Flashing",      ["flashing"]],
  ["Valley Repair", ["valley repair","valley"]],
  ["Ridge Cap",     ["ridge cap","ridge"]],
  ["Full Repair",   ["full repair"]],
];

// ── Parsing ───────────────────────────────────────────────────────────────────
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
      job.shingleType = parts[0];
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
  return (chunks.length > 0 ? chunks : [rawText.trim()]).filter(Boolean).map((b, i) => parseJobBlock(b, i));
}

// ── Map helpers ───────────────────────────────────────────────────────────────
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
      <div className="overflow-hidden rounded-2xl" style={{ height: "calc(100vh - 280px)", minHeight: 320 }}>
        <MapContainer center={[35.55, -97.5]} zoom={8} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds positions={positions} />
          {mappedJobs.map(job => (
            <Marker key={job.id} position={coords[job.address]}>
              <Popup>
                <div style={{ fontFamily: "Inter, sans-serif", fontSize: 13, lineHeight: 1.6, minWidth: 160 }}>
                  <strong>{job.address}</strong><br />
                  {job.status}{job.pay ? ` · ${job.pay}` : ""}<br />
                  {job.jobType && <>{job.jobType}<br /></>}
                  {job.shingle}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      {pending > 0 && <p className="text-center mt-3" style={{ fontSize: 12, color: "#94A3B8" }}>Locating {pending} address{pending !== 1 ? "es" : ""}…</p>}
      {jobs.length === 0 && <p className="text-center py-12" style={{ fontSize: 14, color: "#94A3B8" }}>No active jobs to map yet.</p>}
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusDot({ status }) {
  const m = STATUS_META[status] || STATUS_META.Pending;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
      style={{ background: m.bg, color: m.text }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: m.color }} />
      {m.label}
    </span>
  );
}

// ── Job Card ──────────────────────────────────────────────────────────────────
function JobCard({ job, onUpdate, onDelete }) {
  const [editing,    setEditing]    = useState(false);
  const [form,       setForm]       = useState(job);
  const [editingPay, setEditingPay] = useState(false);
  const [payDraft,   setPayDraft]   = useState(job.pay);
  const [expanded,   setExpanded]   = useState(false);

  const save = () => { onUpdate(form); setEditing(false); };
  const f    = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const commitPay = () => {
    const raw = payDraft.trim();
    onUpdate({ ...job, pay: raw && !raw.startsWith("$") ? `$${raw}` : raw });
    setEditingPay(false);
  };

  const hasDetails = job.shingle || job.pitch || job.notes;
  const sm = STATUS_META[job.status] || STATUS_META.Pending;

  return (
    <div className="bg-white rounded-2xl mb-3 overflow-hidden"
         style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)", border: "1px solid #F1F5F9" }}>

      {/* Status color bar */}
      <div style={{ height: 3, background: sm.color }} />

      <div className="p-4">
        {/* Row 1: address + actions */}
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            {editing ? (
              <input
                className="font-semibold w-full outline-none border-b-2 pb-0.5 bg-transparent text-sm"
                style={{ color: "#0F172A", borderColor: NAVY }}
                value={form.address}
                onChange={e => f("address", e.target.value)}
                placeholder="Address"
              />
            ) : (
              <p className="font-semibold text-sm leading-snug" style={{ color: "#0F172A" }}>
                {job.address || <em style={{ color: "#CBD5E1" }}>No address</em>}
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            {!editing && hasDetails && (
              <button
                onClick={() => setExpanded(e => !e)}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                style={{ background: "#F8FAFC", color: "#94A3B8" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d={expanded ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"} strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
            <button
              onClick={() => editing ? save() : setEditing(true)}
              className="h-7 px-3 rounded-lg text-xs font-semibold transition-colors"
              style={editing
                ? { background: NAVY, color: "white" }
                : { background: "#F1F5F9", color: "#475569" }}
            >
              {editing ? "Save" : "Edit"}
            </button>
            <button
              onClick={() => onDelete(job.id)}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
              style={{ background: "#FFF1F2", color: "#F43F5E" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Row 2: status + chips */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          <StatusDot status={job.status} />

          {job.jobType && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full"
              style={{ background: "#F0F4FF", color: "#3730A3" }}>
              {job.jobType}
            </span>
          )}

          {/* Inline pay editor */}
          {editingPay ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full"
              style={{ background: "#F0FDF4", color: "#166534", border: "1px solid #86EFAC" }}>
              <span>$</span>
              <input
                autoFocus
                className="w-14 bg-transparent outline-none"
                style={{ color: "#166534" }}
                value={payDraft.replace(/^\$/, "")}
                onChange={e => setPayDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") commitPay(); if (e.key === "Escape") setEditingPay(false); }}
              />
              <button onClick={commitPay} className="font-bold opacity-70 hover:opacity-100">✓</button>
              <button onClick={() => setEditingPay(false)} className="opacity-40 hover:opacity-70">✕</button>
            </span>
          ) : (
            <button
              onClick={() => { setPayDraft(job.pay || ""); setEditingPay(true); }}
              title="Tap to edit price"
              className="text-xs font-semibold px-2.5 py-1 rounded-full transition-colors"
              style={job.pay
                ? { background: "#F0FDF4", color: "#166534" }
                : { background: "#F8FAFC", color: "#94A3B8", border: "1px dashed #CBD5E1" }}
            >
              {job.pay || "+ price"}
            </button>
          )}

          {job.roofer && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full"
              style={{ background: "#FFF7ED", color: "#9A3412" }}>
              {job.roofer}
            </span>
          )}
        </div>

        {/* Expandable detail row */}
        {!editing && expanded && hasDetails && (
          <div className="mt-3 pt-3 space-y-1" style={{ borderTop: "1px solid #F1F5F9" }}>
            {job.shingle && (
              <div className="flex gap-2 text-xs">
                <span style={{ color: "#94A3B8", minWidth: 52 }}>Shingle</span>
                <span style={{ color: "#334155" }}>{job.shingle}</span>
              </div>
            )}
            {job.pitch && (
              <div className="flex gap-2 text-xs">
                <span style={{ color: "#94A3B8", minWidth: 52 }}>Pitch</span>
                <span style={{ color: "#334155" }}>{job.pitch}</span>
              </div>
            )}
            {job.notes && (
              <div className="flex gap-2 text-xs">
                <span style={{ color: "#94A3B8", minWidth: 52 }}>Notes</span>
                <span style={{ color: "#334155" }}>{job.notes}</span>
              </div>
            )}
          </div>
        )}

        {/* Edit form */}
        {editing && (
          <div className="mt-3 pt-3 grid grid-cols-2 gap-3" style={{ borderTop: "1px solid #F1F5F9" }}>
            {[["Roofer","roofer"],["Pay","pay"],["Shingle","shingle"],["Pitch / Stories","pitch"]].map(([label, key]) => (
              <div key={key}>
                <label className="block text-xs font-medium mb-1" style={{ color: "#64748B" }}>{label}</label>
                <input
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none focus:ring-2"
                  style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", color: "#0F172A" }}
                  value={form[key]}
                  onChange={e => f(key, e.target.value)}
                />
              </div>
            ))}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "#64748B" }}>Job Type</label>
              <select
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", color: "#0F172A" }}
                value={form.jobType} onChange={e => f("jobType", e.target.value)}
              >
                <option value="">— select —</option>
                {JOB_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "#64748B" }}>Status</label>
              <select
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", color: "#0F172A" }}
                value={form.status} onChange={e => f("status", e.target.value)}
              >
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1" style={{ color: "#64748B" }}>Notes</label>
              <textarea
                className="w-full rounded-xl px-3 py-2 text-xs outline-none resize-none"
                style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", color: "#0F172A" }}
                rows={2} value={form.notes} onChange={e => f("notes", e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Quick status footer */}
      {!editing && (
        <div className="px-4 pb-3">
          <select
            className="text-xs font-medium rounded-xl px-3 py-2 outline-none w-full"
            style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", color: "#475569" }}
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

// ── Nav icons ─────────────────────────────────────────────────────────────────
function NavIcon({ type, active }) {
  const c = active ? NAVY : "#94A3B8";
  if (type === "jobs") return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
      <rect x="9" y="3" width="6" height="4" rx="1"/>
      <path d="M9 12h6M9 16h4"/>
    </svg>
  );
  if (type === "map") return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
      <circle cx="12" cy="9" r="2.5" fill={active ? NAVY : "none"}/>
    </svg>
  );
  if (type === "add") return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={active ? 2.5 : 2} strokeLinecap="round">
      <circle cx="12" cy="12" r="9"/>
      <path d="M12 8v8M8 12h8"/>
    </svg>
  );
  return null;
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ value, label, accent }) {
  return (
    <div className="bg-white rounded-2xl p-3 flex flex-col gap-1"
         style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #F1F5F9" }}>
      <div className="w-6 h-1 rounded-full" style={{ background: accent }} />
      <p className="text-xl font-bold leading-none mt-1" style={{ color: "#0F172A" }}>{value}</p>
      <p className="text-xs font-medium" style={{ color: "#94A3B8" }}>{label}</p>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [jobs, setJobs] = useState(() => {
    try { return JSON.parse(localStorage.getItem("jobs") || "[]"); } catch { return []; }
  });
  const [rawText,      setRawText]      = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterRoofer, setFilterRoofer] = useState("All");
  const [tab,          setTab]          = useState("jobs");

  useEffect(() => {
    try { localStorage.setItem("jobs", JSON.stringify(jobs)); } catch {}
  }, [jobs]);

  const addJobs = () => {
    if (!rawText.trim()) return;
    setJobs(prev => [...parseMultipleJobs(rawText), ...prev]);
    setRawText("");
    setTab("jobs");
  };

  const updateJob = (u) => setJobs(prev => prev.map(j => j.id === u.id ? u : j));
  const deleteJob = (id)  => setJobs(prev => prev.filter(j => j.id !== id));

  const roofers = useMemo(() => ["All", ...new Set(jobs.map(j => j.roofer).filter(Boolean))], [jobs]);

  const filtered = jobs.filter(j => {
    if (filterStatus !== "All" && j.status !== filterStatus) return false;
    if (filterRoofer !== "All" && j.roofer !== filterRoofer) return false;
    return true;
  });

  const revenue = jobs
    .filter(j => ["Accepted","Scheduled","Completed"].includes(j.status))
    .reduce((s, j) => { const n = parseFloat((j.pay || "").replace(/[$,]/g, "")); return s + (isNaN(n) ? 0 : n); }, 0);

  const TABS = [
    { key: "jobs", type: "jobs", label: "Jobs"    },
    { key: "map",  type: "map",  label: "Map"     },
    { key: "add",  type: "add",  label: "Add Job" },
  ];

  return (
    <div style={{ background: "#F8FAFC", minHeight: "100vh", fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* ── Header ── */}
      <header className="sticky top-0 z-40"
        style={{ background: NAVY, boxShadow: "0 1px 0 rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-3 px-4 py-3 max-w-2xl mx-auto">
          <img src="/logo.svg" alt="RRP" className="h-9 w-9 shrink-0 object-contain" />
          <div>
            <p className="text-white font-bold text-sm leading-none tracking-tight">Roof Repair Partners</p>
            <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.45)", letterSpacing: "0.08em" }}>JOB TRACKER</p>
          </div>
          <div className="ml-auto">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)" }}>
              {jobs.length} job{jobs.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <div style={{ height: 2, background: RED }} />
      </header>

      {/* ── Content ── */}
      <div className="max-w-2xl mx-auto px-4 pt-5 pb-28">

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 mb-5">
          <StatCard value={jobs.length}                      label="Total"     accent={NAVY}      />
          <StatCard value={jobs.filter(j=>j.status==="Pending").length}   label="Pending"   accent="#F59E0B"  />
          <StatCard value={jobs.filter(j=>j.status==="Completed").length} label="Done"      accent="#10B981"  />
          <StatCard value={`$${revenue.toLocaleString()}`}  label="Revenue"   accent={RED}       />
        </div>

        {/* Desktop tabs */}
        <div className="hidden sm:flex mb-5 rounded-xl overflow-hidden" style={{ border: "1px solid #E2E8F0" }}>
          {TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className="flex-1 py-2.5 text-sm font-semibold transition-colors"
              style={tab === key
                ? { background: NAVY, color: "white" }
                : { background: "white", color: "#64748B" }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Jobs tab ── */}
        {tab === "jobs" && (
          <>
            {/* Filters */}
            <div className="flex gap-2 mb-4">
              <select
                className="flex-1 text-sm font-medium rounded-xl px-3 py-2.5 outline-none"
                style={{ background: "white", border: "1px solid #E2E8F0", color: "#374151" }}
                value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              >
                <option value="All">All Statuses</option>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
              {roofers.length > 1 && (
                <select
                  className="flex-1 text-sm font-medium rounded-xl px-3 py-2.5 outline-none"
                  style={{ background: "white", border: "1px solid #E2E8F0", color: "#374151" }}
                  value={filterRoofer} onChange={e => setFilterRoofer(e.target.value)}
                >
                  {roofers.map(r => <option key={r}>{r}</option>)}
                </select>
              )}
            </div>

            {filtered.length > 0 && (
              <p className="text-xs font-medium mb-3" style={{ color: "#94A3B8" }}>
                {filtered.length} job{filtered.length !== 1 ? "s" : ""}
              </p>
            )}

            {filtered.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                     style={{ background: "#F1F5F9" }}>
                  <img src="/logo.svg" alt="" className="w-10 h-10 opacity-30" />
                </div>
                <p className="font-semibold text-sm" style={{ color: "#334155" }}>No jobs yet</p>
                <p className="text-sm mt-1 mb-5" style={{ color: "#94A3B8" }}>Paste job text to get started</p>
                <button onClick={() => setTab("add")}
                  className="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl text-white"
                  style={{ background: NAVY }}>
                  Add First Job
                </button>
              </div>
            ) : (
              filtered.map(job => <JobCard key={job.id} job={job} onUpdate={updateJob} onDelete={deleteJob} />)
            )}
          </>
        )}

        {/* ── Map tab ── */}
        {tab === "map" && (
          <div className="bg-white rounded-2xl overflow-hidden"
               style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #F1F5F9" }}>
            <div className="flex items-center justify-between px-4 py-3"
                 style={{ borderBottom: "1px solid #F1F5F9" }}>
              <p className="text-sm font-semibold" style={{ color: "#0F172A" }}>Active Job Map</p>
              <span className="text-xs font-medium px-2 py-1 rounded-lg" style={{ background: "#F8FAFC", color: "#64748B" }}>
                {jobs.filter(j => ["Accepted","Scheduled","Completed"].includes(j.status)).length} pins
              </span>
            </div>
            <div className="p-3">
              <MapView jobs={jobs.filter(j => ["Accepted","Scheduled","Completed"].includes(j.status))} />
            </div>
          </div>
        )}

        {/* ── Add tab ── */}
        {tab === "add" && (
          <div className="bg-white rounded-2xl p-5"
               style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #F1F5F9" }}>
            <p className="text-sm font-semibold mb-1" style={{ color: "#0F172A" }}>Paste Job Text</p>
            <p className="text-xs mb-4" style={{ color: "#94A3B8" }}>
              Each line starting with a street number begins a new job. Bullet points fill in details.
            </p>
            <textarea
              className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none font-mono"
              style={{
                background: "#F8FAFC", border: "1px solid #E2E8F0",
                color: "#334155", height: 180,
              }}
              placeholder={"12016 NW 120th St. Yukon, OK 73099\n- Roof Final & Paint PVC Pipes\n- 1 story, 7 pitch\n- Prolam Weathered Wood\n- $75\n\n9 N Walnut St. Edmond, OK 73003\n- Pipe Boot\n- 2 story\n- $150"}
              value={rawText}
              onChange={e => setRawText(e.target.value)}
            />
            <div className="flex gap-2 mt-3">
              <button onClick={addJobs}
                className="flex-1 py-3 text-sm font-semibold text-white rounded-xl transition-opacity active:opacity-80"
                style={{ background: NAVY }}>
                Parse &amp; Add Jobs
              </button>
              <button onClick={() => setRawText("")}
                className="px-4 py-3 text-sm font-medium rounded-xl transition-colors"
                style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", color: "#64748B" }}>
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom nav (mobile) ── */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 sm:hidden bg-white"
           style={{
             borderTop: "1px solid #F1F5F9",
             paddingBottom: "env(safe-area-inset-bottom, 0px)",
             boxShadow: "0 -4px 24px rgba(0,0,0,0.06)",
           }}>
        <div className="flex">
          {TABS.map(({ key, type, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className="flex-1 flex flex-col items-center justify-center py-3 gap-1.5"
              style={{ minHeight: 60 }}>
              <NavIcon type={type} active={tab === key} />
              <span className="text-xs font-semibold"
                style={{ color: tab === key ? NAVY : "#94A3B8" }}>
                {label}
              </span>
              {tab === key && (
                <span className="absolute bottom-1 w-4 h-0.5 rounded-full" style={{ background: RED }} />
              )}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
