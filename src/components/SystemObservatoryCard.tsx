// SystemObservatoryCard — Unified observability & interpretability panel.
import { cn } from "@/lib/utils";
import { NYX_AGENTS } from "@/lib/nyx-agents";
import {
  causalTraceback,
  type ObservatorySnapshot,
  type RegimeLabel,
} from "@/lib/nyx-observatory";

const REGIME_COLOR: Record<RegimeLabel, string> = {
  "Stable Convergence": "bg-[oklch(0.93_0.06_160)] text-primary",
  "Polarized Stalemate": "bg-[oklch(0.93_0.06_25)] text-primary",
  "Fragmented Failure": "bg-[oklch(0.92_0.07_55)] text-primary",
  "Cascading Breakdown": "bg-[oklch(0.88_0.08_25)] text-primary",
  "Transitional": "bg-secondary/60 text-secondary-foreground",
};

function agentName(id: string) {
  return NYX_AGENTS.find((a) => a.id === id)?.name ?? id;
}

export function SystemObservatoryCard({
  history,
  isFinal,
}: {
  history: ObservatorySnapshot[];
  isFinal: boolean;
}) {
  if (!history.length) return null;
  const latest = history[history.length - 1];
  return (
    <div className="glass rounded-[22px] p-4 space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
            System State Observatory
          </div>
          <div className="font-display text-sm font-semibold">Why this is happening</div>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider", REGIME_COLOR[latest.regime])}>
          {latest.regime}
        </span>
      </header>

      {/* Stability Radar */}
      <StabilityRadar radar={latest.radar} />

      {/* Dominant forces */}
      <section>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-primary">Dominant Forces · this round</h3>
          <span className="font-mono text-[9px] text-muted-foreground">weighted Δ</span>
        </div>
        <ul className="space-y-1">
          {latest.dominantForces.map((f) => {
            const pct = Math.min(100, f.absImpact * 600);
            const up = f.direction === "up";
            return (
              <li key={f.variable} className="flex items-center gap-2 text-[11px]">
                <span className="w-32 truncate font-medium">{f.variable}</span>
                <div className="relative h-1.5 flex-1 rounded-full bg-secondary/50 overflow-hidden">
                  <div className={cn("absolute inset-y-0 left-0 rounded-full",
                    up ? "bg-[oklch(0.7_0.12_160)]" : "bg-[oklch(0.65_0.16_25)]")}
                    style={{ width: `${pct}%` }} />
                </div>
                <span className={cn("w-14 text-right font-mono tabular-nums text-[10px]",
                  up ? "text-[oklch(0.55_0.12_160)]" : "text-[oklch(0.55_0.16_25)]")}>
                  {up ? "+" : ""}{f.delta.toFixed(3)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Top contributing agents */}
      {latest.topAgents.length > 0 && (
        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-primary">Top Movers</h3>
          <div className="flex flex-wrap gap-1.5">
            {latest.topAgents.map((a) => (
              <span key={a.agentId} className="rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] font-mono">
                {agentName(a.agentId)} · Δrep {a.absRepDelta.toFixed(2)}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Emergence badges */}
      {latest.emergence.length > 0 && (
        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-primary">Emergent Patterns</h3>
          <div className="flex flex-wrap gap-1.5">
            {latest.emergence.map((e) => (
              <span key={e} className="rounded-full bg-[oklch(0.93_0.05_300)] px-2 py-0.5 text-[10px] font-semibold text-primary">
                ⚡ {e}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Regime history strip */}
      {history.length > 1 && (
        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-primary">Regime Trace</h3>
          <div className="flex flex-wrap gap-1">
            {history.map((s) => (
              <span key={s.round} className={cn(
                "rounded-md px-1.5 py-0.5 font-mono text-[9px]",
                REGIME_COLOR[s.regime],
              )} title={`Round ${s.round + 1}: ${s.regime}`}>
                R{s.round + 1}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Causal traceback after final round */}
      {isFinal && history.length >= 2 && (
        <section className="rounded-xl bg-white/70 p-2.5">
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-primary">Causal Traceback</h3>
          <p className="text-[11px] leading-relaxed text-foreground">
            {causalTraceback(history, agentName)}
          </p>
        </section>
      )}

      <p className="text-[10px] leading-snug text-muted-foreground">
        Derived from existing telemetry. Observability layer only — no mechanics added.
      </p>
    </div>
  );
}

function StabilityRadar({ radar }: { radar: ObservatorySnapshot["radar"] }) {
  const axes = [
    { key: "trust", label: "Trust", value: radar.trust },
    { key: "entropyHealth", label: "Entropy", value: radar.entropyHealth },
    { key: "polarizationCalm", label: "Calm", value: radar.polarizationCalm },
    { key: "centralizationBalance", label: "Balance", value: radar.centralizationBalance },
    { key: "cascadeCalm", label: "Cascade-", value: radar.cascadeCalm },
  ];
  const cx = 70, cy = 70, R = 52;
  const n = axes.length;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v];
  };
  const ringPts = (v: number) =>
    axes.map((_, i) => pt(i, v).join(",")).join(" ");
  const dataPts = axes.map((a, i) => pt(i, a.value).join(",")).join(" ");
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/60 p-2">
      <svg width={140} height={140} viewBox="0 0 140 140">
        {[0.25, 0.5, 0.75, 1].map((r) => (
          <polygon key={r} points={ringPts(r)} fill="none" stroke="oklch(0.85 0.02 230)" strokeWidth={0.6} />
        ))}
        {axes.map((_, i) => {
          const [x, y] = pt(i, 1);
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="oklch(0.85 0.02 230)" strokeWidth={0.5} />;
        })}
        <polygon points={dataPts} fill="oklch(0.7 0.14 230 / 0.35)" stroke="oklch(0.55 0.16 230)" strokeWidth={1.5} />
        {axes.map((a, i) => {
          const [x, y] = pt(i, 1.18);
          return (
            <text key={a.key} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
              fontSize="7.5" fontFamily="ui-monospace" fill="oklch(0.4 0 0)">
              {a.label}
            </text>
          );
        })}
      </svg>
      <ul className="flex-1 space-y-0.5 text-[10px] font-mono text-muted-foreground">
        {axes.map((a) => (
          <li key={a.key} className="flex justify-between">
            <span>{a.label}</span>
            <span className="tabular-nums text-foreground">{(a.value * 100).toFixed(0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
