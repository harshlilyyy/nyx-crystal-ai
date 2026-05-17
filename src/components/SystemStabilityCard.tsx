// SystemStabilityCard — Early Warning Signals panel.
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip as RTooltip } from "recharts";
import type { StabilityReport } from "@/lib/nyx-complex";
import { cn } from "@/lib/utils";

export function SystemStabilityCard({
  report,
  trustVarHistory,
  polVarHistory,
}: {
  report: StabilityReport | null;
  trustVarHistory: number[];
  polVarHistory: number[];
}) {
  if (!report) return null;
  const data = trustVarHistory.map((v, i) => ({
    round: i + 1,
    trust: v,
    pol: polVarHistory[i] ?? 0,
  }));
  const warn = report.instability || report.slowing;
  return (
    <div className="glass rounded-[22px] p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
          System Stability · Early Warnings
        </div>
        <span className={cn(
          "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider",
          warn ? "bg-[oklch(0.93_0.06_25)] text-primary" : "bg-secondary/60 text-secondary-foreground",
        )}>
          {warn ? "Watch" : "Stable"}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <StabilityMeter value={report.stability} />
        <div className="flex-1 space-y-1 text-[10px] font-mono text-muted-foreground">
          <div className="flex justify-between"><span>trust σ²</span><span className="tabular-nums">{report.trustVariance.toFixed(4)}</span></div>
          <div className="flex justify-between"><span>polariz σ²</span><span className="tabular-nums">{report.polarizationVariance.toFixed(4)}</span></div>
          <div className="flex justify-between"><span>recovery·t</span><span className="tabular-nums">{report.recoveryTime ?? "—"}</span></div>
        </div>
      </div>
      {report.instability && (
        <div className="rounded-xl bg-[oklch(0.93_0.06_25)] px-2.5 py-1.5 text-[11px] font-medium text-primary">
          ⚠ Critical Instability Rising
        </div>
      )}
      {report.slowing && (
        <div className="rounded-xl bg-[oklch(0.92_0.07_55)] px-2.5 py-1.5 text-[11px] font-medium text-primary">
          ⚠ Critical Slowing Detected
        </div>
      )}
      {data.length > 1 && (
        <div className="h-[120px] rounded-2xl bg-white/70 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="round" tick={{ fontSize: 9 }} stroke="oklch(0.6 0 0)" />
              <YAxis tick={{ fontSize: 9 }} stroke="oklch(0.6 0 0)" />
              <RTooltip contentStyle={{ fontSize: 10, borderRadius: 8 }} />
              <Line type="monotone" dataKey="trust" stroke="oklch(0.55 0.12 230)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="pol" stroke="oklch(0.6 0.16 25)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="text-[10px] leading-snug text-muted-foreground">
        Tracks rolling variance of trust and polarization over a 5-round window.
        Rising variance or slowing recovery hint at upcoming critical transitions.
      </p>
    </div>
  );
}

function StabilityMeter({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const color =
    pct >= 70 ? "oklch(0.7 0.12 160)" :
    pct >= 40 ? "oklch(0.75 0.12 80)" :
    "oklch(0.6 0.18 25)";
  const r = 22, cx = 28, cy = 28;
  const start = -135, end = 135;
  const angle = start + (end - start) * (pct / 100);
  const polar = (a: number) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
  const [sx, sy] = polar(start);
  const [ex, ey] = polar(end);
  const [vx, vy] = polar(angle);
  return (
    <div className="flex flex-col items-center">
      <svg width={56} height={56} viewBox="0 0 56 56">
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}`} fill="none" stroke="oklch(0.88 0.02 230)" strokeWidth={4} strokeLinecap="round" />
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${pct > 50 ? 1 : 0} 1 ${vx} ${vy}`} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" />
        <text x="28" y="32" textAnchor="middle" fontSize="13" fontFamily="ui-monospace" fontWeight="700" fill="oklch(0.3 0 0)">
          {pct}
        </text>
      </svg>
      <div className="text-[8px] uppercase tracking-wider text-muted-foreground">stability</div>
    </div>
  );
}
