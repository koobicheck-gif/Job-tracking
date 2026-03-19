import { useState, useMemo, useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet default marker icons for Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

const JOB_TYPES = ["Pipe Boot", "Shingle Repair", "Final Report", "Flashing", "Valley Repair", "Ridge Cap", "Full Repair", "Other"];
const STATUSES = ["Pending", "Accepted", "Scheduled", "Completed", "Declined"];

const STATUS_COLORS = {
  Pending: "bg-yellow-100 text-yellow-800",
  Accepted: "bg-blue-100 text-blue-800",
  Scheduled: "bg-purple-100 text-purple-800",
  Completed: "bg-green-100 text-green-800",
  Declined: "bg-red-100 text-red-800",
};

// Ordered so more specific terms match first
const JOB_KEYWORDS = [
  ["Final Report", ["final report", "roof final", "final"]],
  ["Pipe Boot",    ["pipe boot"]],
  ["Shingle Repair", ["shingle repair"]],
  ["Flashing",     ["flashing"]],
  ["Valley Repair",["valley repair", "valley"]],
  ["Ridge Cap",    ["ridge cap", "ridge"]],
  ["Full Repair",  ["full repair"]],
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

    // First line is always the address
    if (i === 0) { job.address = cleaned; return; }

    // Pay
    const payMatch = line.match(/\$[\d,]+(\.\d{2})?/);
    if (payMatch) { job.pay = payMatch[0]; return; }

    // Stories / pitch info
    if (l.includes("story") || l.includes("pitch")) { job.pitch = cleaned; return; }

    // Roofer
    if (/^(roofer|from|sent by)[:\s]/i.test(l)) {
      job.roofer = cleaned.replace(/^(roofer|from|sent by)[:\s]*/i, "").trim();
      return;
    }

    // Notes
    if (/^notes?[:\s]/i.test(l)) { job.notes = cleaned.replace(/^notes?[:\s]*/i, "").trim(); return; }

    // Job type
    let matched = false;
    for (const [type, keywords] of JOB_KEYWORDS) {
      if (keywords.some(kw => l.includes(kw))) { job.jobType = type; matched = true; break; }
    }
    if (matched) return;

    // Remaining bullet = shingle info (e.g. "Prolam Weathered Wood")
    if (!job.shingle) {
      job.shingle = cleaned;
      const parts = cleaned.split(" ");
      if (parts.length >= 2) {
        job.shingleType = parts[0];
        job.shingleColor = parts.slice(1).join(" ");
      } else {
        job.shingleType = cleaned;
      }
    }
  });

  return job;
}

// Split a raw text blob into per-job blocks by detecting address lines,
// then parse each block individually.
function parseMultipleJobs(rawText) {
  const lines = rawText.split("\n");
  const chunks = [];
  let current = [];

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    // Address line: starts with one or more digits then whitespace + word
    if (/^\d+\s+\w/.test(t) && current.length > 0) {
      chunks.push(current.join("\n"));
      current = [t];
    } else {
      current.push(t);
    }
  }
  if (current.length > 0) chunks.push(current.join("\n"));

  const blocks = chunks.length > 0 ? chunks : [rawText.trim()];
  return blocks.filter(Boolean).map((block, i) => parseJobBlock(block, i));
}

// Adjusts map view to fit all markers
function FitBounds({ positions }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 1) map.fitBounds(positions, { padding: [50, 50] });
    else if (positions.length === 1) map.setView(positions[0], 13);
  }, [positions.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function MapView({ jobs }) {
  const [coords, setCoords] = useState(() => {
    try { return JSON.parse(localStorage.getItem("geocodeCache") || "{}"); } catch { return {}; }
  });
  const queueRef  = useRef([]);
  const runningRef = useRef(false);

  async function drainQueue() {
    if (runningRef.current) return;
    runningRef.current = true;
    while (queueRef.current.length > 0) {
      const { address } = queueRef.current.shift();
      try {
        const res  = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`
        );
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
      await new Promise(r => setTimeout(r, 1150)); // Nominatim: max 1 req/s
    }
    runningRef.current = false;
  }

  useEffect(() => {
    jobs.forEach(job => {
      if (!job.address || coords[job.address]) return;
      if (!queueRef.current.some(q => q.address === job.address)) {
        queueRef.current.push({ address: job.address });
      }
    });
    drainQueue();
  }, [jobs]); // eslint-disable-line react-hooks/exhaustive-deps

  const mappedJobs = jobs.filter(j => j.address && coords[j.address]);
  const positions  = mappedJobs.map(j => coords[j.address]);
  const pending    = jobs.filter(j => j.address && !coords[j.address]).length;

  return (
    <div>
      <div className="rounded-xl overflow-hidden border border-gray-200" style={{ height: 460 }}>
        <MapContainer center={[35.55, -97.5]} zoom={8} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds positions={positions} />
          {mappedJobs.map(job => (
            <Marker key={job.id} position={coords[job.address]}>
              <Popup>
                <div style={{ fontSize: 13, lineHeight: "1.5", minWidth: 160 }}>
                  <strong>{job.address}</strong><br />
                  <span>{job.status}{job.pay ? ` · ${job.pay}` : ""}</span><br />
                  {job.jobType && <span>{job.jobType}<br /></span>}
                  {job.pitch   && <span>{job.pitch}<br /></span>}
                  {job.shingle && <span>{job.shingle}</span>}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      {pending > 0 && (
        <p className="text-xs text-gray-400 text-center pt-1.5">
          Locating {pending} address{pending !== 1 ? "es" : ""}…
        </p>
      )}
      {jobs.length === 0 && (
        <p className="text-sm text-gray-400 text-center pt-4">No jobs to map yet.</p>
      )}
    </div>
  );
}

function JobCard({ job, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(job);

  const save = () => { onUpdate(form); setEditing(false); };
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          {editing ? (
            <input className="font-semibold text-gray-900 border-b border-blue-400 w-full mb-1 outline-none"
              value={form.address} onChange={e => f("address", e.target.value)} placeholder="Address" />
          ) : (
            <p className="font-semibold text-gray-900">{job.address || <span className="text-gray-400 italic">No address</span>}</p>
          )}
          <div className="flex flex-wrap gap-2 mt-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[job.status]}`}>{job.status}</span>
            {job.jobType && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{job.jobType}</span>}
            {job.pay     && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">{job.pay}</span>}
            {job.roofer  && <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">📤 {job.roofer}</span>}
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={() => editing ? save() : setEditing(true)}
            className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100">
            {editing ? "Save" : "Edit"}
          </button>
          <button onClick={() => onDelete(job.id)} className="text-xs px-2 py-1 rounded bg-red-50 text-red-500 hover:bg-red-100">✕</button>
        </div>
      </div>

      {editing && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div><label className="text-xs text-gray-500">Roofer</label>
            <input className="w-full border rounded px-2 py-1 mt-0.5" value={form.roofer} onChange={e => f("roofer", e.target.value)} /></div>
          <div><label className="text-xs text-gray-500">Pay</label>
            <input className="w-full border rounded px-2 py-1 mt-0.5" value={form.pay} onChange={e => f("pay", e.target.value)} /></div>
          <div><label className="text-xs text-gray-500">Shingle</label>
            <input className="w-full border rounded px-2 py-1 mt-0.5" value={form.shingle} onChange={e => f("shingle", e.target.value)} /></div>
          <div><label className="text-xs text-gray-500">Pitch / Stories</label>
            <input className="w-full border rounded px-2 py-1 mt-0.5" value={form.pitch} onChange={e => f("pitch", e.target.value)} /></div>
          <div><label className="text-xs text-gray-500">Job Type</label>
            <select className="w-full border rounded px-2 py-1 mt-0.5" value={form.jobType} onChange={e => f("jobType", e.target.value)}>
              <option value="">-- Select --</option>
              {JOB_TYPES.map(t => <option key={t}>{t}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-500">Status</label>
            <select className="w-full border rounded px-2 py-1 mt-0.5" value={form.status} onChange={e => f("status", e.target.value)}>
              {STATUSES.map(s => <option key={s}>{s}</option>)}
            </select></div>
          <div className="col-span-2"><label className="text-xs text-gray-500">Notes</label>
            <textarea className="w-full border rounded px-2 py-1 mt-0.5 text-xs" rows={2} value={form.notes} onChange={e => f("notes", e.target.value)} /></div>
        </div>
      )}

      {!editing && (job.shingle || job.shingleColor || job.pitch || job.notes) && (
        <div className="mt-2 text-xs text-gray-500 space-y-0.5">
          {job.shingle && <p>Shingle: {job.shingle}</p>}
          {!job.shingle && job.shingleColor && <p>Color: {job.shingleColor}</p>}
          {job.pitch   && <p>Pitch: {job.pitch}</p>}
          {job.notes   && <p>Notes: {job.notes}</p>}
        </div>
      )}

      {!editing && (
        <div className="mt-2">
          <select className="text-xs border rounded px-2 py-1 bg-gray-50" value={job.status}
            onChange={e => onUpdate({ ...job, status: e.target.value })}>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      )}
    </div>
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

  // Persist jobs to localStorage
  useEffect(() => {
    try { localStorage.setItem("jobs", JSON.stringify(jobs)); } catch {}
  }, [jobs]);

  const addJobs = () => {
    if (!rawText.trim()) return;
    const parsed = parseMultipleJobs(rawText);
    setJobs(prev => [...parsed, ...prev]);
    setRawText("");
    setTab("dashboard");
  };

  const updateJob = (updated) => setJobs(prev => prev.map(j => j.id === updated.id ? updated : j));
  const deleteJob = (id)      => setJobs(prev => prev.filter(j => j.id !== id));

  const roofers = useMemo(() => ["All", ...new Set(jobs.map(j => j.roofer).filter(Boolean))], [jobs]);

  const filtered = jobs.filter(j => {
    if (filterStatus !== "All" && j.status !== filterStatus) return false;
    if (filterRoofer !== "All" && j.roofer !== filterRoofer) return false;
    return true;
  });

  const totalAccepted = jobs
    .filter(j => ["Accepted", "Scheduled", "Completed"].includes(j.status))
    .reduce((sum, j) => {
      const n = parseFloat((j.pay || "").replace(/[$,]/g, ""));
      return sum + (isNaN(n) ? 0 : n);
    }, 0);

  const acceptedCount = jobs.filter(j => j.status === "Accepted").length;

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-gray-900">RRP Job Tracker</h1>
          <p className="text-sm text-gray-500">Sub-contractor jobs from other roofers</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <p className="text-2xl font-bold text-gray-900">{jobs.length}</p>
            <p className="text-xs text-gray-500">Total Jobs</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <p className="text-2xl font-bold text-blue-600">{acceptedCount}</p>
            <p className="text-xs text-gray-500">Accepted</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <p className="text-2xl font-bold text-emerald-600">${totalAccepted.toLocaleString()}</p>
            <p className="text-xs text-gray-500">Accepted $</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <button onClick={() => setTab("dashboard")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium ${tab === "dashboard" ? "bg-gray-900 text-white" : "bg-white border text-gray-600"}`}>
            Dashboard
          </button>
          <button onClick={() => setTab("map")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium ${tab === "map" ? "bg-gray-900 text-white" : "bg-white border text-gray-600"}`}>
            Map
          </button>
          <button onClick={() => setTab("add")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium ${tab === "add" ? "bg-gray-900 text-white" : "bg-white border text-gray-600"}`}>
            + Add Jobs
          </button>
        </div>

        {/* Add Jobs Tab */}
        {tab === "add" && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
            <p className="text-sm font-medium text-gray-700 mb-1">Paste job text</p>
            <p className="text-xs text-gray-400 mb-2">
              Each address line starts a new job. Bullets fill in the details automatically.
            </p>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm h-48 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
              placeholder={"12016 NW 120th St. Yukon, OK 73099\n- Roof Final & Paint PVC Pipes\n- 1 story, 7 pitch\n- Prolam Weathered Wood\n- $75\n\n9 N Walnut St. Edmond, OK 73003\n- Roof Final & Paint Pipes\n- 2 story, 6 pitch\n- Prolam Black Shadow\n- $75"}
              value={rawText}
              onChange={e => setRawText(e.target.value)}
            />
            <div className="flex gap-2 mt-2">
              <button onClick={addJobs} className="flex-1 bg-gray-900 text-white rounded-lg py-2 text-sm font-medium hover:bg-gray-800">
                Parse &amp; Add Jobs
              </button>
              <button onClick={() => setRawText("")} className="px-4 py-2 border rounded-lg text-sm text-gray-500 hover:bg-gray-50">
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Map Tab */}
        {tab === "map" && (
          <MapView jobs={jobs.filter(j => ["Accepted", "Scheduled", "Completed"].includes(j.status))} />
        )}

        {/* Dashboard Tab */}
        {tab === "dashboard" && (
          <>
            <div className="flex gap-2 mb-4 flex-wrap">
              <select className="text-sm border rounded-lg px-3 py-1.5 bg-white" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="All">All Statuses</option>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
              <select className="text-sm border rounded-lg px-3 py-1.5 bg-white" value={filterRoofer} onChange={e => setFilterRoofer(e.target.value)}>
                {roofers.map(r => <option key={r}>{r}</option>)}
              </select>
            </div>

            {filtered.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <p className="text-4xl mb-2">📋</p>
                <p className="text-sm">No jobs yet. Paste a text to get started.</p>
                <button onClick={() => setTab("add")} className="mt-3 text-sm text-blue-500 underline">Add your first job</button>
              </div>
            ) : (
              filtered.map(job => <JobCard key={job.id} job={job} onUpdate={updateJob} onDelete={deleteJob} />)
            )}
          </>
        )}
      </div>
    </div>
  );
}
