// AttractorTelemetryCards — Advanced-only telemetry for dynamical primitives.
// All values are derived/transient; nothing persisted.
import { NYX_AGENTS } from "@/lib/nyx-agents";
import { topNetworkHubs, weightedOutDegree, type VerdictMode } from "@/lib/nyx-dynamics";
import {
  LineChart, Line, XAxis, YAxis, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip,
  BarChart, Bar,
} from "recharts";
import { cn } from "@/lib/utils";

export interface AttractorTelemetryProps {
  entropyHistory: number[];
  proximityHistoryPerAgent: Record<string, number[]>;
  lockedRounds: Record<string, number>;
  cascadeThresholds: Record<string, number>;
  influenceNetwork: Record<string, Record<string, number>>;
  modesPerAgent: Record<string, VerdictMode>;
  predictionErrorPerAgent?: Record<string, number[]>;
  memoryStrengthPerAgent?: Record<string, number[]>;
  cascadePressurePerAgent?: Record<string, number>;
}

function agentName(id: string) {
  const a = NYX_AGENTS.find((x) => x.id === id);
  return a?.name ?? id;
}

function mean(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

export function AttractorTelemetryCards({
  entropyHistory,
  proximityHistoryPerAgent,
  lockedRounds,
  cascadeThresholds,
  influenceNetwork,
  modesPerAgent,
  predictionErrorPerAgent,
  memoryStrengthPerAgent,
  cascadePressurePerAgent,
}: AttractorTelemetryProps) {
  // Strongest basin: mode with highest mean proximity across agents.
  const basinScores: Record<string, { sum: number; n: number }> = {};
  for (const id in proximityHistoryPerAgent) {
    const mode = modesPerAgent[id];
    if (!mode) continue;
    const last = proximityHistoryPerAgent[id].slice(-3);
    const m = mean(last);
    const b = basinScores[mode] ?? { sum: 0, n: 0 };
    b.sum += m; b.n += 1;
    basinScores[mode] = b;
  }
  const strongestBasin = Object.entries(basinScores)
    .map(([k, v]) => ({ mode: k, score: v.sum / Math.max(1, v.n) }))
    .sort((a, b) => b.score - a.score)[0];

  // Cascade histogram: bucket thresholds into 6 bins from 0.25..0.55
  const bins = Array.from({ length: 6 }, (_, i) => ({
    bucket: (0.25 + i * 0.05).toFixed(2),
    count: 0,
  }));
  for (const id in cascadeThresholds) {
    const v = cascadeThresholds[id];
    const idx = Math.min(5, Math.max(0, Math.floor((v - 0.25) / 0.05)));
    bins[idx].count += 1;
  }

  const hubs = topNetworkHubs(influenceNetwork, 3);
  const entropyData = entropyHistory.map((v, i) => ({ round: i + 1, H: v }));

  return (
    <div className="glass rounded-[22px] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
          Dynamical Primitives
        </div>
        <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-secondary-foreground">
          Attractor · Entropy · BA-net
        </span>
      </div>

      {/* Narrative Diversity */}
      <div className="rounded-2xl bg-white/70 p-3">
        <div className="flex items-baseline justify-between">
          <div className="text-[11px] font-semibold">Narrative Diversity (Shannon H)</div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {entropyHistory.length ? `H = ${entropyHistory[entropyHistory.length - 1].toFixed(2)}` : "—"}
          </div>
        </div>
        <div className="text-[10px] leading-snug text-muted-foreground">
          Healthy 1.5–2.0 · Monoculture warning &lt; 0.8.
        </div>
        <div className="mt-2 h-[120px]">
          {entropyData.length > 0 && (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={entropyData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <XAxis dataKey="round" tick={{ fontSize: 9 }} stroke="oklch(0.6 0 0)" />
                <YAxis domain={[0, 2]} tick={{ fontSize: 9 }} stroke="oklch(0.6 0 0)" />
                <ReferenceLine y={0.8} stroke="oklch(0.6 0.18 25)" strokeDasharray="3 3" />
                <RTooltip contentStyle={{ fontSize: 10, borderRadius: 8 }} />
                <Line type="monotone" dataKey="H" stroke="oklch(0.45 0.12 230)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Strongest basin */}
        <div className="rounded-2xl bg-white/70 p-3">
          <div className="text-[11px] font-semibold">Strongest Attractor Basin</div>
          {strongestBasin ? (
            <>
              <div className="mt-1 text-sm font-bold">{strongestBasin.mode.replace(/_/g, " ")}</div>
              <div className="font-mono text-[10px] text-muted-foreground">
                mean proximity = {strongestBasin.score.toFixed(3)}
              </div>
            </>
          ) : (
            <div className="text-[10px] text-muted-foreground">No data yet</div>
          )}
        </div>

        {/* Top hubs */}
        <div className="rounded-2xl bg-white/70 p-3">
          <div className="text-[11px] font-semibold">Top Network Hubs</div>
          {hubs.length === 0 ? (
            <div className="text-[10px] text-muted-foreground">No edges yet</div>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {hubs.map((h) => {
                const a = NYX_AGENTS.find((x) => x.id === h.id);
                return (
                  <li key={h.id} className="flex items-center justify-between text-[10px]">
                    <span className="truncate">{a?.avatar} {a?.name ?? h.id}</span>
                    <span className="font-mono text-muted-foreground">{h.degree.toFixed(2)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Cascade threshold histogram */}
      <div className="rounded-2xl bg-white/70 p-3">
        <div className="text-[11px] font-semibold">Cascade Threshold Distribution (Granovetter)</div>
        <div className="mt-1 h-[120px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bins} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="bucket" tick={{ fontSize: 9 }} stroke="oklch(0.6 0 0)" />
              <YAxis allowDecimals={false} tick={{ fontSize: 9 }} stroke="oklch(0.6 0 0)" />
              <RTooltip contentStyle={{ fontSize: 10, borderRadius: 8 }} />
              <Bar dataKey="count" fill="oklch(0.6 0.12 230)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-agent drill-down */}
      <div className="rounded-2xl bg-white/70 p-3">
        <div className="text-[11px] font-semibold">Agent Drill-Down</div>
        <div className="mt-2 space-y-2">
          {Object.keys(proximityHistoryPerAgent).sort().map((id) => {
            const series = proximityHistoryPerAgent[id];
            const last = series[series.length - 1] ?? 0;
            const thr = cascadeThresholds[id] ?? 0.4;
            const locked = (lockedRounds[id] ?? 0) >= 3;
            const deg = weightedOutDegree(influenceNetwork, id);
            const data = series.map((v, i) => ({ r: i + 1, p: v }));
            const peSeries = predictionErrorPerAgent?.[id] ?? [];
            const memSeries = memoryStrengthPerAgent?.[id] ?? [];
            const pressure = cascadePressurePerAgent?.[id] ?? 0;
            return (
              <div key={id} className="rounded-xl bg-secondary/30 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 truncate text-[11px] font-semibold">
                    <span>{NYX_AGENTS.find((a) => a.id === id)?.avatar}</span>
                    <span className="truncate">{agentName(id)}</span>
                    {locked && (
                      <span className="rounded-full bg-[oklch(0.93_0.06_25)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                        🔒 Locked
                      </span>
                    )}
                    {pressure > 0.4 && (
                      <span
                        title="Cascade pressure from anxious/polarized neighbors"
                        className="rounded-full bg-[oklch(0.92_0.07_55)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary"
                      >
                        ⚡ {pressure.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[9px] text-muted-foreground">
                    prox {last.toFixed(2)} · deg {deg.toFixed(2)}
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  {/* Proximity sparkline */}
                  <div className="h-[36px] flex-1" title="Attractor proximity (cosine to mode centroid)">
                    {data.length > 1 && (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                          <YAxis hide domain={[0, 1]} />
                          <Line type="monotone" dataKey="p" stroke="oklch(0.45 0.12 230)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                          <ReferenceLine y={0.9} stroke="oklch(0.6 0.18 25)" strokeDasharray="2 2" />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                  {/* Radial gauge for cascade threshold */}
                  <CascadeGauge value={thr} />
                </div>
                {(peSeries.length > 1 || memSeries.length > 1) && (
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    {peSeries.length > 1 && (
                      <div
                        className="h-[28px]"
                        title="Prediction Error — agents minimize surprise between expected and observed world states."
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={peSeries.map((v, i) => ({ r: i + 1, v }))} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                            <YAxis hide domain={[0, 1]} />
                            <Line type="monotone" dataKey="v" stroke="oklch(0.55 0.16 25)" strokeWidth={1.3} dot={false} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                        <div className="text-[8px] uppercase tracking-wider text-muted-foreground">pred err</div>
                      </div>
                    )}
                    {memSeries.length > 1 && (
                      <div
                        className="h-[28px]"
                        title="Memory Intensity — mean episodic buffer strength (decays 3% per round; +0.2 boost on cascade/strong-valence events)."
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={memSeries.map((v, i) => ({ r: i + 1, v }))} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                            <YAxis hide domain={[0, 1.2]} />
                            <Line type="monotone" dataKey="v" stroke="oklch(0.55 0.12 80)" strokeWidth={1.3} dot={false} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                        <div className="text-[8px] uppercase tracking-wider text-muted-foreground">memory</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CascadeGauge({ value }: { value: number }) {
  // Map 0.25..0.55 onto a 270° arc.
  const min = 0.25, max = 0.55;
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const r = 16; const cx = 22; const cy = 22;
  const start = -135, end = 135;
  const angle = start + (end - start) * pct;
  const polar = (a: number) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
  const [sx, sy] = polar(start);
  const [ex, ey] = polar(end);
  const [vx, vy] = polar(angle);
  const large = end - start > 180 ? 1 : 0;
  return (
    <div className="flex flex-col items-center">
      <svg width={44} height={44} viewBox="0 0 44 44">
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`} fill="none" stroke="oklch(0.85 0.02 230)" strokeWidth={3} strokeLinecap="round" />
        <path
          d={`M ${sx} ${sy} A ${r} ${r} 0 ${pct > 0.5 ? 1 : 0} 1 ${vx} ${vy}`}
          fill="none" stroke="oklch(0.55 0.16 25)" strokeWidth={3} strokeLinecap="round"
        />
        <text x="22" y="25" textAnchor="middle" fontSize="9" fontFamily="ui-monospace" fill="oklch(0.3 0 0)">
          {value.toFixed(2)}
        </text>
      </svg>
      <div className={cn("text-[8px] uppercase tracking-wider text-muted-foreground")}>cascade θ</div>
    </div>
  );
}
