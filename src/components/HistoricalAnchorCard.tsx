// Historical Anchor — Phase 1: store an uploaded CSV + chosen target metric
// in localStorage for future calibration. No automated calibration yet.
import { useEffect, useState } from "react";
import { AlertTriangle, Upload } from "lucide-react";

const STORAGE_KEY = "nyx_historical_anchor";

const METRICS = [
  { value: "reputation_mean", label: "Reputation Mean" },
  { value: "inequality", label: "Inequality" },
  { value: "trust_proxy", label: "Trust Proxy" },
  { value: "centralization", label: "Centralization" },
] as const;

interface Stored {
  filename: string;
  metric: string;
  csvPreview: string;
  rows: number;
  uploadedAt: number;
}

export function HistoricalAnchorCard() {
  const [stored, setStored] = useState<Stored | null>(null);
  const [metric, setMetric] = useState<string>("reputation_mean");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Stored;
        setStored(parsed);
        setMetric(parsed.metric);
      }
    } catch { /* ignore */ }
  }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
    const data: Stored = {
      filename: f.name,
      metric,
      csvPreview: lines.slice(0, 5).join("\n"),
      rows: Math.max(0, lines.length - 1),
      uploadedAt: Date.now(),
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
    setStored(data);
  }

  function onMetric(v: string) {
    setMetric(v);
    if (stored) {
      const next = { ...stored, metric: v };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      setStored(next);
    }
  }

  function clear() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setStored(null);
  }

  return (
    <div className="glass rounded-[22px] p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
            Historical Anchor
          </div>
          <div className="text-[11px] text-muted-foreground">
            Optional outcome data for future calibration.
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-2xl bg-white/60 px-3 py-2 text-xs">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Target metric
        </label>
        <select
          value={metric}
          onChange={(e) => onMetric(e.target.value)}
          className="rounded-full bg-white/70 px-2 py-1 text-[11px] outline-none"
        >
          {METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-white/40 px-3 py-3 text-[11px] text-muted-foreground hover:bg-white/60">
        <Upload className="h-3.5 w-3.5" />
        <span>{stored ? "Replace CSV" : "Upload Historical Outcome Data (CSV)"}</span>
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
      </label>
      {stored && (
        <div className="rounded-xl bg-secondary/40 px-2 py-1.5 text-[10px] font-mono leading-snug">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{stored.filename}</span>
            <button onClick={clear} className="text-[9px] text-primary hover:underline">Clear</button>
          </div>
          <div className="text-muted-foreground">{stored.rows} rows · target: {stored.metric}</div>
          <pre className="mt-1 overflow-x-auto whitespace-pre text-[9px] text-muted-foreground">{stored.csvPreview}</pre>
        </div>
      )}
      <div className="flex items-start gap-1.5 rounded-xl bg-[oklch(0.92_0.07_55)] px-2 py-1.5 text-[10px] leading-snug text-primary">
        <AlertTriangle className="mt-0.5 h-3 w-3 flex-none" />
        <span>Historical calibration requires 1,000-seed parameter sweeps — coming in Phase 2.</span>
      </div>
    </div>
  );
}
