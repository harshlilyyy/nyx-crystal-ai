import { useMemo, useState } from "react";
import type { Simulation, AgentRuntime } from "@/lib/nyx-types";
import { NYX_AGENTS } from "@/lib/nyx-agents";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";

const CORE_VARS = [
  "self_worth", "anxiety", "consistency", "momentum", "reputation",
  "opportunity_access", "fragility_index", "lock_in", "learning_rate", "energy",
] as const;

const MODE_COLOR: Record<string, string> = {
  AVOID: "#C26B6B",
  EXECUTE: "#6FA984",
  RECOVER: "#6E8FC4",
  OPTIMIZE: "#A77BC2",
};

function modeOf(rt: AgentRuntime): string {
  return (rt.lastIntent?.type ?? rt.modeV5 ?? rt.mode ?? "EXECUTE").toString().toUpperCase();
}

function nameOf(id: string) {
  const m = NYX_AGENTS.find((a) => a.id === id);
  return m?.name ?? id;
}
function avatarOf(id: string) {
  const m = NYX_AGENTS.find((a) => a.id === id);
  return m?.avatar ?? "🜁";
}

// ════════════════════════════════════════════
// PANEL 5 — NARRATIVE TIMELINE
// ════════════════════════════════════════════

type EventKind = "round" | "cascade" | "recovery" | "anchor" | "mode" | "assassin";

interface TimelineEvent {
  round: number;
  kind: EventKind;
  agentId?: string;
  title: string;
  detail: string;
  color: string;
  icon: string;
}

function buildTimeline(sim: Simulation): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const prevMode: Record<string, string> = {};
  const prevAnchor: Record<string, string | null> = {};
  const prevCascade: Record<string, boolean> = {};

  sim.rounds.forEach((r, i) => {
    events.push({
      round: i,
      kind: "round",
      title: `Round ${i + 1} begins`,
      detail: `Director: ${r.director ?? "—"} · ${Object.keys(r.stateSnapshot ?? {}).length} agents active`,
      color: "#9d9282",
      icon: "◯",
    });
    const snap = r.stateSnapshot ?? {};
    Object.entries(snap).forEach(([id, rt]) => {
      const m = modeOf(rt);
      // mode shift
      if (prevMode[id] && prevMode[id] !== m) {
        events.push({
          round: i,
          kind: "mode",
          agentId: id,
          title: `${nameOf(id)} shifted mode`,
          detail: `${prevMode[id]} → ${m}`,
          color: "#D6913B",
          icon: "↻",
        });
      }
      prevMode[id] = m;
      // cascade
      if (rt.cascade && !prevCascade[id]) {
        const crossed: string[] = [];
        if (rt.core) {
          if (rt.core.fragility_index > 0.7) crossed.push("fragility_index>0.7");
          if (rt.core.self_worth < 0.3) crossed.push("self_worth<0.3");
          if (rt.core.anxiety > 0.7) crossed.push("anxiety>0.7");
        }
        events.push({
          round: i,
          kind: "cascade",
          agentId: id,
          title: `${nameOf(id)} entered cascade`,
          detail: crossed.length ? `Crossed: ${crossed.join(", ")}` : "Negative loop triggered",
          color: "#C26B6B",
          icon: "▼",
        });
      }
      prevCascade[id] = !!rt.cascade;
      // recovery
      if (rt.lastResolvedOutcome?.outcome === "success" && (rt.successStreak ?? 0) >= 1 && i > 0) {
        const prev = sim.rounds[i - 1]?.stateSnapshot?.[id];
        if (prev?.cascade && !rt.cascade) {
          events.push({
            round: i,
            kind: "recovery",
            agentId: id,
            title: `${nameOf(id)} recovered`,
            detail: `Cascade resolved · success streak ${rt.successStreak}`,
            color: "#6FA984",
            icon: "▲",
          });
        }
      }
      // emotional anchor activation
      const aName = rt.emotionalAnchor?.name ?? null;
      if (aName && prevAnchor[id] !== aName) {
        events.push({
          round: i,
          kind: "anchor",
          agentId: id,
          title: `${nameOf(id)} anchor: ${aName}`,
          detail: `intensity ${rt.emotionalAnchor!.intensity.toFixed(2)} · valence ${rt.emotionalAnchor!.valence.toFixed(2)}`,
          color: "#A77BC2",
          icon: "❖",
        });
      }
      prevAnchor[id] = aName;
    });
  });

  const a = sim.report?.assassin;
  if (a?.assumption) {
    events.push({
      round: sim.rounds.length - 1,
      kind: "assassin",
      title: `BlackSwan: fragile assumption`,
      detail: `${a.assumption} — ${a.whyFragile ?? ""}`,
      color: "#1E1E1E",
      icon: "✶",
    });
  }
  return events;
}

export function NarrativeTimelinePanel({ sim }: { sim: Simulation }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const events = useMemo(() => buildTimeline(sim), [sim]);

  return (
    <section className="glass rounded-2xl p-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between"
      >
        <h2 className="font-display text-base font-semibold">Narrative Timeline</h2>
        <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
          {events.length} events
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>
      {open && (
        <div className="mt-3 max-h-[520px] overflow-y-auto pr-1">
          <div className="relative">
            {/* center line */}
            <div className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-border/60" />
            <ul className="space-y-3">
              {events.map((e, i) => {
                const left = i % 2 === 0;
                const isExp = expanded === i;
                return (
                  <li key={i} className="relative flex items-start">
                    <div
                      className={cn(
                        "w-[calc(50%-12px)]",
                        left ? "pr-3 text-right" : "ml-auto pl-3"
                      )}
                    >
                      <button
                        onClick={() => setExpanded(isExp ? null : i)}
                        className="w-full rounded-xl p-2 text-left transition hover:opacity-90"
                        style={{ background: `${e.color}22`, border: `1px solid ${e.color}55` }}
                      >
                        <div className="flex items-center gap-1.5" style={{ flexDirection: left ? "row-reverse" : "row" }}>
                          <span className="text-base" style={{ color: e.color }}>{e.icon}</span>
                          {e.agentId && <span className="text-base">{avatarOf(e.agentId)}</span>}
                          <span className="font-mono text-[9px] text-muted-foreground">R{e.round + 1} · t={e.round * 10}m</span>
                        </div>
                        <div className="mt-1 text-[11px] font-semibold leading-tight">{e.title}</div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground line-clamp-2">{e.detail}</div>
                        {isExp && (
                          <div className="mt-1.5 rounded-lg bg-white/60 p-1.5 font-mono text-[9px] text-foreground/80">
                            {e.detail}
                          </div>
                        )}
                      </button>
                    </div>
                    {/* dot */}
                    <span
                      className="absolute left-1/2 top-2 h-2.5 w-2.5 -translate-x-1/2 rounded-full ring-2 ring-background"
                      style={{ background: e.color }}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

// ════════════════════════════════════════════
// PANEL 6 — RIDGE PLOT (self_worth distribution per round)
// ════════════════════════════════════════════

function gaussian(x: number, mu: number, sigma: number) {
  const a = 1 / (sigma * Math.sqrt(2 * Math.PI));
  const e = Math.exp(-0.5 * Math.pow((x - mu) / sigma, 2));
  return a * e;
}

export function SentimentRidgePanel({ sim }: { sim: Simulation }) {
  const [hoverR, setHoverR] = useState<number | null>(null);
  const W = 280, perRowH = 28, padX = 8;
  const rows = sim.rounds.map((r, i) => {
    const snap = r.stateSnapshot ?? {};
    const vals = Object.values(snap).map((rt: any) => rt.core?.self_worth ?? rt.state?.self_worth ?? 0);
    const mean = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    // contradiction max
    const contra = Object.values(snap).reduce((m: number, rt: any) => Math.max(m, rt.contradictionScore ?? 0), 0);
    const cascades = Object.values(snap).filter((rt: any) => rt.cascade).length;
    return { round: i, vals, mean, contra, cascades };
  });
  const H = rows.length * perRowH + 16;

  function colorFor(mean: number) {
    if (mean > 0.6) return "#6E8FC4";
    if (mean < 0.4) return "#C26B6B";
    return "#9d9282";
  }

  function pathFor(vals: number[], yBase: number) {
    if (!vals.length) return "";
    const sigma = 0.08;
    const samples = 40;
    const pts: string[] = [];
    let maxD = 0;
    const ys: number[] = [];
    for (let s = 0; s <= samples; s++) {
      const x = s / samples;
      let d = 0;
      vals.forEach((v) => { d += gaussian(x, v, sigma); });
      d /= vals.length;
      ys.push(d);
      if (d > maxD) maxD = d;
    }
    const norm = maxD || 1;
    for (let s = 0; s <= samples; s++) {
      const x = padX + (s / samples) * (W - padX * 2);
      const y = yBase - (ys[s] / norm) * (perRowH - 6);
      pts.push(`${s === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
    }
    pts.push(`L${padX + (W - padX * 2)},${yBase}`);
    pts.push(`L${padX},${yBase}`);
    pts.push("Z");
    return pts.join(" ");
  }

  const hov = hoverR != null ? rows[hoverR] : rows[rows.length - 1];

  return (
    <section className="glass rounded-2xl p-3">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-base font-semibold">Sentiment Ridge</h2>
        <span className="font-mono text-[9px] text-muted-foreground">self_worth · {rows.length}r</span>
      </header>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {rows.map((row, i) => {
          const yBase = (i + 1) * perRowH;
          const c = colorFor(row.mean);
          return (
            <g
              key={i}
              onMouseEnter={() => setHoverR(i)}
              onMouseLeave={() => setHoverR(null)}
              style={{ cursor: "pointer" }}
            >
              <rect x={0} y={yBase - perRowH} width={W} height={perRowH} fill="transparent" />
              <path d={pathFor(row.vals, yBase)} fill={c} fillOpacity={hoverR === i ? 0.8 : 0.45} stroke={c} strokeWidth={0.8} />
              <text x={padX} y={yBase - perRowH + 9} fontSize={8} fill="#5a4a44" fontFamily="Courier Prime">R{i + 1}</text>
            </g>
          );
        })}
      </svg>
      {hov && (
        <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px]">
          <div className="rounded-lg bg-white/60 p-1.5">
            <div className="text-[8px] text-muted-foreground">Mean self_worth</div>
            <div className="font-mono">{hov.mean.toFixed(2)}</div>
          </div>
          <div className="rounded-lg bg-white/60 p-1.5">
            <div className="text-[8px] text-muted-foreground">Max contradiction</div>
            <div className="font-mono">{hov.contra.toFixed(2)}</div>
          </div>
          <div className="rounded-lg bg-white/60 p-1.5">
            <div className="text-[8px] text-muted-foreground">In cascade</div>
            <div className="font-mono">{hov.cascades}</div>
          </div>
        </div>
      )}
    </section>
  );
}

// ════════════════════════════════════════════
// PANEL 7 — INFLUENCE FLOW (Sankey-ish)
// ════════════════════════════════════════════

export function InfluenceSankeyPanel({ sim }: { sim: Simulation }) {
  const [round, setRound] = useState(sim.rounds.length - 1);
  const [showCounter, setShowCounter] = useState(false);
  const a = sim.report?.assassin;
  const hasSens = !!(a && a.targetVariable && a.baselineOutcome && a.perturbedOutcome);

  const ids = sim.agentIds ?? Object.keys(sim.runtime ?? {});
  const snap = sim.rounds[round]?.stateSnapshot ?? {};

  const edges = sim.graph?.edges ?? [];
  // existence_value proxy: target's reputation × source's signal-ish (opportunity_access)
  function existenceVal(srcId: string, tgtId: string) {
    const s = snap[srcId]; const t = snap[tgtId];
    const rep = t?.core?.reputation ?? 0.5;
    const opp = s?.core?.opportunity_access ?? 0.5;
    return Math.max(0.05, rep * 0.6 + opp * 0.4);
  }

  const W = 300, H = 240, leftX = 30, rightX = W - 30;
  const lineH = ids.length > 0 ? (H - 30) / ids.length : 30;

  function yFor(id: string) {
    const idx = ids.indexOf(id);
    return 20 + idx * lineH + lineH / 2;
  }

  const flows = edges
    .map((e) => {
      const ev = existenceVal(e.source, e.target);
      const thickness = Math.abs(e.weight) * ev * 6;
      const color = e.weight > 0.05 ? "#6FA984" : e.weight < -0.05 ? "#C26B6B" : "#9d9282";
      const counterDelta = showCounter && hasSens ? (e.weight * (a!.sensitivityScore ?? 0.2)) : 0;
      return { ...e, ev, thickness, color, counterDelta };
    })
    .filter((f) => f.thickness > 0.1);

  return (
    <section className="glass rounded-2xl p-3">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold">Influence Flow</h2>
        <div className="flex items-center gap-1.5">
          <select
            value={round}
            onChange={(e) => setRound(Number(e.target.value))}
            className="rounded-lg bg-white/70 px-1.5 py-0.5 font-mono text-[10px] outline-none ring-1 ring-border"
          >
            {sim.rounds.map((_, i) => <option key={i} value={i}>R{i + 1}</option>)}
          </select>
          {hasSens && (
            <button
              onClick={() => setShowCounter((s) => !s)}
              className={cn(
                "rounded-lg px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                showCounter ? "bg-primary text-primary-foreground" : "bg-white/70 text-muted-foreground"
              )}
            >
              CF
            </button>
          )}
        </div>
      </header>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {flows.map((f, i) => {
          const y1 = yFor(f.source), y2 = yFor(f.target);
          const cx1 = leftX + 60, cx2 = rightX - 60;
          const dash = showCounter && Math.abs(f.counterDelta) > 0.05 ? "4 2" : undefined;
          const tk = Math.max(0.5, f.thickness + (showCounter ? f.counterDelta * 4 : 0));
          return (
            <path
              key={i}
              d={`M${leftX},${y1} C${cx1},${y1} ${cx2},${y2} ${rightX},${y2}`}
              stroke={f.color}
              strokeWidth={tk}
              strokeOpacity={0.55}
              fill="none"
              strokeDasharray={dash}
            />
          );
        })}
        {ids.map((id) => {
          const m = snap[id] ? modeOf(snap[id]) : "EXECUTE";
          const c = MODE_COLOR[m] ?? "#9d9282";
          return (
            <g key={`l-${id}`}>
              <circle cx={leftX} cy={yFor(id)} r={5} fill={c} stroke="#fff" strokeWidth={1} />
              <text x={leftX - 6} y={yFor(id) + 3} fontSize={8} fill="#5a4a44" fontFamily="Inter" textAnchor="end">
                {nameOf(id).slice(0, 10)}
              </text>
              <circle cx={rightX} cy={yFor(id)} r={5} fill={c} stroke="#fff" strokeWidth={1} />
              <text x={rightX + 6} y={yFor(id) + 3} fontSize={8} fill="#5a4a44" fontFamily="Inter">
                {nameOf(id).slice(0, 10)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-2 text-[8px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "#6FA984" }} />positive</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "#C26B6B" }} />negative</span>
        {hasSens && showCounter && <span className="font-mono">— counterfactual overlay</span>}
      </div>
    </section>
  );
}

// ════════════════════════════════════════════
// PANEL 8 — AGENT STORYLINE
// ════════════════════════════════════════════

export function AgentStorylinePanel({ sim, onSelect }: { sim: Simulation; onSelect: (id: string) => void }) {
  const ids = sim.agentIds ?? Object.keys(sim.runtime ?? {});
  const rounds = sim.rounds.length;
  const W = 300, H = Math.max(140, ids.length * 22 + 30), padX = 24, padY = 20;
  const colW = (W - padX * 2) / Math.max(1, rounds);

  // For each round, group agents by mode and assign vertical slots
  // Slot index per (round, agentId)
  const slotAt: Record<string, Record<number, number>> = {};
  const modes: ("AVOID" | "EXECUTE" | "RECOVER" | "OPTIMIZE")[] = ["AVOID", "EXECUTE", "RECOVER", "OPTIMIZE"];
  ids.forEach((id) => { slotAt[id] = {}; });
  for (let r = 0; r < rounds; r++) {
    const snap = sim.rounds[r].stateSnapshot ?? {};
    const grouped: Record<string, string[]> = {};
    ids.forEach((id) => {
      const rt = snap[id];
      const m = rt ? modeOf(rt) : "EXECUTE";
      const key = modes.includes(m as any) ? m : "EXECUTE";
      (grouped[key] ||= []).push(id);
    });
    let slot = 0;
    modes.forEach((m) => {
      (grouped[m] ?? []).forEach((id) => {
        slotAt[id][r] = slot++;
      });
    });
  }

  const yFor = (slot: number) => padY + slot * ((H - padY * 2) / Math.max(1, ids.length - 1 || 1));

  return (
    <section className="glass rounded-2xl p-3">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-base font-semibold">Storyline</h2>
        <span className="font-mono text-[9px] text-muted-foreground">mode convergence</span>
      </header>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* round gridlines */}
        {Array.from({ length: rounds }, (_, r) => (
          <text key={r} x={padX + r * colW + colW / 2} y={H - 4} fontSize={8} fill="#9d9282" fontFamily="Courier Prime" textAnchor="middle">
            R{r + 1}
          </text>
        ))}
        {ids.map((id) => {
          const snapEnd = sim.rounds[rounds - 1]?.stateSnapshot?.[id];
          const m = snapEnd ? modeOf(snapEnd) : "EXECUTE";
          const color = MODE_COLOR[m] ?? "#9d9282";
          const pts: string[] = [];
          for (let r = 0; r < rounds; r++) {
            const x = padX + r * colW + colW / 2;
            const snap = sim.rounds[r].stateSnapshot ?? {};
            const rt = snap[id];
            const mm = rt ? modeOf(rt) : "EXECUTE";
            const c = MODE_COLOR[mm] ?? "#9d9282";
            const y = yFor(slotAt[id][r] ?? 0);
            pts.push(`${r === 0 ? "M" : "L"}${x},${y}`);
            // dot
            // (drawn in second pass for color per round)
            void c;
          }
          return (
            <g key={id} onClick={() => onSelect(id)} style={{ cursor: "pointer" }}>
              <path d={pts.join(" ")} fill="none" stroke={color} strokeWidth={3} strokeOpacity={0.55} strokeLinecap="round" strokeLinejoin="round" />
              {Array.from({ length: rounds }, (_, r) => {
                const x = padX + r * colW + colW / 2;
                const snap = sim.rounds[r].stateSnapshot ?? {};
                const rt = snap[id];
                const mm = rt ? modeOf(rt) : "EXECUTE";
                const c = MODE_COLOR[mm] ?? "#9d9282";
                return <circle key={r} cx={x} cy={yFor(slotAt[id][r] ?? 0)} r={3} fill={c} stroke="#fff" strokeWidth={1} />;
              })}
              <text x={padX - 4} y={yFor(slotAt[id][0] ?? 0) + 3} fontSize={7} fill="#5a4a44" fontFamily="Inter" textAnchor="end">
                {nameOf(id).slice(0, 8)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-2 text-[8px] text-muted-foreground">
        {modes.map((m) => (
          <span key={m} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: MODE_COLOR[m] }} />{m}
          </span>
        ))}
      </div>
    </section>
  );
}

// ════════════════════════════════════════════
// PANEL 9 — VARIABLE IMPORTANCE HEATMAP
// ════════════════════════════════════════════

export function VariableHeatmapPanel({ sim }: { sim: Simulation }) {
  const ids = sim.agentIds ?? Object.keys(sim.runtime ?? {});
  const a = sim.report?.assassin;
  const hasSens = !!a?.targetVariable;
  const dominantVar = a?.targetVariable ?? null;

  // variance per agent per var
  const variance = useMemo(() => {
    const res: Record<string, Record<string, number>> = {};
    let perVarSum: Record<string, number> = {};
    let perVarN: Record<string, number> = {};
    ids.forEach((id) => {
      res[id] = {};
      CORE_VARS.forEach((v) => {
        const series: number[] = [];
        sim.rounds.forEach((r) => {
          const rt = r.stateSnapshot?.[id];
          if (rt?.core) series.push(rt.core[v] ?? 0);
        });
        const m = series.reduce((s, x) => s + x, 0) / Math.max(1, series.length);
        const va = series.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, series.length);
        res[id][v] = va;
        perVarSum[v] = (perVarSum[v] ?? 0) + va;
        perVarN[v] = (perVarN[v] ?? 0) + 1;
      });
    });
    const perVar: Record<string, number> = {};
    CORE_VARS.forEach((v) => { perVar[v] = (perVarSum[v] ?? 0) / Math.max(1, perVarN[v] ?? 1); });
    return { cells: res, perVar };
  }, [sim, ids]);

  const allVals = Object.values(variance.cells).flatMap((row) => Object.values(row));
  const maxV = Math.max(0.0001, ...allVals);

  const sortedVars = [...CORE_VARS].sort((x, y) => variance.perVar[y] - variance.perVar[x]);
  const mostVolatile = sortedVars[0];
  const mostStable = sortedVars[sortedVars.length - 1];

  return (
    <section className="glass rounded-2xl p-3">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-base font-semibold">Variable Heatmap</h2>
        <span className="font-mono text-[9px] text-muted-foreground">variance</span>
      </header>
      <div className="overflow-x-auto">
        <table className="text-[8px]">
          <thead>
            <tr>
              <th className="sticky left-0 bg-transparent p-1" />
              {CORE_VARS.map((v) => (
                <th key={v} className="p-1 font-mono text-[7px] text-muted-foreground" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
                  {v}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ids.map((id) => (
              <tr key={id}>
                <td className="sticky left-0 bg-background/60 pr-1 text-[8px] font-semibold">{nameOf(id).slice(0, 10)}</td>
                {CORE_VARS.map((v) => {
                  const va = variance.cells[id]?.[v] ?? 0;
                  const intensity = Math.min(1, va / maxV);
                  const isDominant = hasSens && dominantVar === v;
                  const isConstrained = (sim.rounds[sim.rounds.length - 1]?.stateSnapshot?.[id]?.dampingDiagnostics?.reputationCapTriggered && v === "reputation")
                    || (sim.rounds[sim.rounds.length - 1]?.stateSnapshot?.[id]?.dampingDiagnostics?.opportunityCapTriggered && v === "opportunity_access");
                  return (
                    <td key={v} className="p-0.5">
                      <div
                        title={`${v}: ${va.toFixed(4)}`}
                        className="h-4 w-4 rounded-sm"
                        style={{
                          background: `rgba(31,30,30,${0.08 + intensity * 0.85})`,
                          outline: isConstrained ? "1.5px solid #C26B6B" : isDominant ? "1.5px solid #D6B36A" : "none",
                          outlineOffset: "-1.5px",
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[9px] text-muted-foreground">
        <span>Most volatile: <span className="font-mono font-semibold text-foreground">{mostVolatile}</span></span>
        <span>· Most stable: <span className="font-mono font-semibold text-foreground">{mostStable}</span></span>
      </div>
      {hasSens && (
        <div className="mt-1 flex gap-2 text-[8px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ outline: "1.5px solid #D6B36A" }} />dominant</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ outline: "1.5px solid #C26B6B" }} />constrained</span>
        </div>
      )}
    </section>
  );
}
