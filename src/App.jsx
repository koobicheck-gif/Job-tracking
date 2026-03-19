import { useState, useMemo } from "react";

const JOB_TYPES = ["Pipe Boot", "Shingle Repair", "Final Report", "Flashing", "Valley Repair", "Ridge Cap", "Full Repair", "Other"];
const STATUSES = ["Pending", "Accepted", "Scheduled", "Completed", "Declined"];

const STATUS_COLORS = {
  Pending: "bg-yellow-100 text-yellow-800",
  Accepted: "bg-blue-100 text-blue-800",
  Scheduled: "bg-purple-100 text-purple-800",
  Completed: "bg-green-100 text-green-800",
  Declined: "bg-red-100 text-red-800",
};

function parseText(raw) {
  const job = {
    id: Date.now(),
    address: "", shingleColor: "", shingleType: "",
    jobType: "", pay: "", roofer: "", notes: "", status: "Pending", raw
  };
  const lines = raw.split(/[\n,;]+/);
  lines.forEach(line => {
    const l = line.toLowerCase().trim();
    if (!l) return;
    if (l.match(/^\d{2,5}\s+\w/) || l.includes("address:")) job.address = line.replace(/address[:\s]*/i, "").trim();
    if (l.includes("color:") || l.includes("color ")) job.shingleColor = line.replace(/.*color[:\s]*/i, "").trim();
    if (l.includes("shingle:") || l.includes("shingle type")) job.shingleType = line.replace(/.*shingle[^:]*:[?\s]*/i, "").trim();
    const payMatch = line.match(/\$[\d,]+(\.\d{2})?/);
    if (payMatch) job.pay = payMatch[0];
    if (l.includes("roofer:") || l.includes("from:") || l.includes("sent by:")) job.roofer = line.replace(/^(roofer|from|sent by)[:\s]*/i, "").trim();
    JOB_TYPES.forEach(t => { if (l.includes(t.toLowerCase())) job.jobType = t; });
    if (l.includes("note:") || l.includes("notes:")) job.notes = line.replace(/notes?[:\s]*/i, "").trim();
  });
  return job;
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
            <input className="font-semibold text-gray-900 border-b border-blue-400 w-full mb-1 outline-none" value={form.address} onChange={e => f("address", e.target.value)} placeholder="Address" />
          ) : (
            <p className="font-semibold text-gray-900">{job.address || <span className="text-gray-400 italic">No address</span>}</p>
          )}
          <div className="flex flex-wrap gap-2 mt-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[job.status]}`}>{job.status}</span>
            {job.jobType && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{job.jobType}</span>}
            {job.pay && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">{job.pay}</span>}
            {job.roofer && <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">📤 {job.roofer}</span>}
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={() => editing ? save() : setEditing(true)} className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100">{editing ? "Save" : "Edit"}</button>
          <button onClick={() => onDelete(job.id)} className="text-xs px-2 py-1 rounded bg-red-50 text-red-500 hover:bg-red-100">✕</button>
        </div>
      </div>

      {editing && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div><label className="text-xs text-gray-500">Roofer</label><input className="w-full border rounded px-2 py-1 mt-0.5" value={form.roofer} onChange={e => f("roofer", e.target.value)} /></div>
          <div><label className="text-xs text-gray-500">Pay</label><input className="w-full border rounded px-2 py-1 mt-0.5" value={form.pay} onChange={e => f("pay", e.target.value)} /></div>
          <div><label className="text-xs text-gray-500">Shingle Color</label><input className="w-full border rounded px-2 py-1 mt-0.5" value={form.shingleColor} onChange={e => f("shingleColor", e.target.value)} /></div>
          <div><label className="text-xs text-gray-500">Shingle Type</label><input className="w-full border rounded px-2 py-1 mt-0.5" value={form.shingleType} onChange={e => f("shingleType", e.target.value)} /></div>
          <div><label className="text-xs text-gray-500">Job Type</label>
            <select className="w-full border rounded px-2 py-1 mt-0.5" value={form.jobType} onChange={e => f("jobType", e.target.value)}>
              <option value="">-- Select --</option>
              {JOB_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div><label className="text-xs text-gray-500">Status</label>
            <select className="w-full border rounded px-2 py-1 mt-0.5" value={form.status} onChange={e => f("status", e.target.value)}>
              {STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="col-span-2"><label className="text-xs text-gray-500">Notes</label><textarea className="w-full border rounded px-2 py-1 mt-0.5 text-xs" rows={2} value={form.notes} onChange={e => f("notes", e.target.value)} /></div>
        </div>
      )}

      {!editing && (job.shingleColor || job.shingleType || job.notes) && (
        <div className="mt-2 text-xs text-gray-500 space-y-0.5">
          {job.shingleColor && <p>Color: {job.shingleColor}</p>}
          {job.shingleType && <p>Type: {job.shingleType}</p>}
          {job.notes && <p>Notes: {job.notes}</p>}
        </div>
      )}

      {!editing && (
        <div className="mt-2">
          <select className="text-xs border rounded px-2 py-1 bg-gray-50" value={job.status} onChange={e => onUpdate({ ...job, status: e.target.value })}>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [jobs, setJobs] = useState([]);
  const [rawText, setRawText] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterRoofer, setFilterRoofer] = useState("All");
  const [tab, setTab] = useState("dashboard");

  const addJob = () => {
    if (!rawText.trim()) return;
    setJobs(prev => [parseText(rawText), ...prev]);
    setRawText("");
    setTab("dashboard");
  };

  const updateJob = (updated) => setJobs(prev => prev.map(j => j.id === updated.id ? updated : j));
  const deleteJob = (id) => setJobs(prev => prev.filter(j => j.id !== id));

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
            <p className="text-2xl font-bold text-yellow-600">{jobs.filter(j => j.status === "Pending").length}</p>
            <p className="text-xs text-gray-500">Pending</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <p className="text-2xl font-bold text-emerald-600">${totalAccepted.toLocaleString()}</p>
            <p className="text-xs text-gray-500">Accepted $</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          <button onClick={() => setTab("dashboard")} className={`px-4 py-1.5 rounded-full text-sm font-medium ${tab === "dashboard" ? "bg-gray-900 text-white" : "bg-white border text-gray-600"}`}>Dashboard</button>
          <button onClick={() => setTab("add")} className={`px-4 py-1.5 rounded-full text-sm font-medium ${tab === "add" ? "bg-gray-900 text-white" : "bg-white border text-gray-600"}`}>+ Add Job</button>
        </div>

        {tab === "add" && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
            <p className="text-sm font-medium text-gray-700 mb-2">Paste text message from roofer</p>
            <p className="text-xs text-gray-400 mb-2">Include: address, shingle color/type, job type, pay, roofer name — it'll auto-parse what it can.</p>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm h-36 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder={"Example:\n1234 Oak St, Edmond\nRoofer: Jake Smith\nJob: Pipe Boot\nColor: Weathered Wood\n$175"}
              value={rawText}
              onChange={e => setRawText(e.target.value)}
            />
            <div className="flex gap-2 mt-2">
              <button onClick={addJob} className="flex-1 bg-gray-900 text-white rounded-lg py-2 text-sm font-medium hover:bg-gray-800">Parse & Add Job</button>
              <button onClick={() => setRawText("")} className="px-4 py-2 border rounded-lg text-sm text-gray-500 hover:bg-gray-50">Clear</button>
            </div>
          </div>
        )}

        {tab === "dashboard" && (
          <>
            {/* Filters */}
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
