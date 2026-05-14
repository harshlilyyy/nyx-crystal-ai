import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { getCurrent } from "@/lib/nyx-store";
import { NYX_AGENTS } from "@/lib/nyx-agents";
import type { AgentRuntime, Simulation } from "@/lib/nyx-types";
import { Download, Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  NarrativeTimelinePanel,
  SentimentRidgePanel,
  InfluenceSankeyPanel,
  AgentStorylinePanel,
  VariableHeatmapPanel,
} from "@/components/OutcomesExtraPanels";
import { LeverageForceGraph } from "@/components/LeverageForceGraph";
import { PanelErrorBoundary, PanelPlaceholder } from "@/components/PanelErrorBoundary";

function isDebugMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("debug_outcomes") === "true";
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/outcomes")({
  head: () => ({
    meta: [
      { title: "Nyx — Outcomes" },
      { name: "description", content: "Timeline, counterfactuals, agent drill-down, and leverage map." },
    ],
  }),
  component: OutcomesPage,
});

const MODE_COLOR: Record<string, string> = {
  AVOID: "#C26B6B",
  EXECUTE: "#6FA984",
  RECOVER: "#6E8FC4",
  OPTIMIZE: "#A77BC2",
  avoidance: "#C26B6B",
  exploration: "#6FA984",
  recovery: "#6E8FC4",
  optimization: "#A77BC2",
  support_collapse: "#8a6f6f",
};

const CORE_VARS = [
  "self_worth", "anxiety", "consistency", "momentum", "reputation",
  "opportunity_access", "fragility_index", "lock_in", "learning_rate", "energy",
] as const;

const LENSES = ["Default", "Equality", "Trust", "Centralization"] as const;
type Lens = typeof LENSES[number];

function modeFor(rt: AgentRuntime): string {
  return rt.lastIntent?.type ?? rt.modeV5 ?? rt.mode ?? "EXECUTE";
}

function agentMeta(id: string) {
  return NYX_AGENTS.find((a) => a.id === id) ?? { id, name: id, role: "—", avatar: "🜁" } as any;
}

function Sparkline({ values, color = "#C8A97E", height = 22, width = 60 }: { values: number[]; color?: string; height?: number; width?: number }) {
  if (!values.length) return <svg width={width} height={height} />;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * (width - 2) + 1;
    const y = height - 1 - ((v - min) / span) * (height - 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function OutcomesPage() {
  const nav = useNavigate();
  const [sim, setSim] = useState<Simulation | undefined>();
  const [roundIdx, setRoundIdx] = useState(0);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>("Default");
  const [playing, setPlaying] = useState(false);
  const playRef = useRef<number | null>(null);

  const debug = isDebugMode();
  const [libError, setLibError] = useState<string | null>(null);

  useEffect(() => {
    // Probe optional viz dependency (react-force-graph-2d). Other extra panels
    // are pure SVG/HTML, so no extra probes required.
    let cancelled = false;
    import("react-force-graph-2d")
      .then(() => { /* ok */ })
      .catch((e) => {
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.error("[Outcomes] react-force-graph-2d failed to load:", e);
          setLibError("react-force-graph-2d");
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const s = getCurrent();
    if (!s || !s.advanced || s.status !== "done") {
      if (debug) { setSim(s ?? undefined); return; }
      nav({ to: "/" });
      return;
    }
    setSim(s);
    const ids = s.agentIds ?? Object.keys(s.runtime ?? {});
    setSelectedAgent(ids[0] ?? null);
  }, [nav, debug]);

  useEffect(() => {
    if (!playing || !sim) return;
    playRef.current = window.setInterval(() => {
      setRoundIdx((i) => {
        const next = i + 1;
        if (next >= sim.rounds.length) { setPlaying(false); return i; }
        return next;
      });
    }, 2000);
    return () => { if (playRef.current) window.clearInterval(playRef.current); };
  }, [playing, sim]);

  if (!sim) {
    if (debug) {
      return (
        <PageShell title="Outcomes" subtitle="Debug mode">
          <div className="glass rounded-2xl p-3">
            <h2 className="font-display text-base font-semibold text-primary">Debug mode: simulation data missing</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              No completed advanced simulation found in storage. Panels are skipped to avoid crashes.
            </p>
            {libError && (
              <p className="mt-2 rounded-xl bg-white/60 p-2 text-[10px] font-mono text-primary">
                ⚠ {libError} not installed. Falling back to simple text view.
              </p>
            )}
          </div>
        </PageShell>
      );
    }
    return <PageShell title="Outcomes" subtitle="Loading…"><div /></PageShell>;
  }

  const round = sim.rounds?.[roundIdx];
  const snap = round?.stateSnapshot ?? sim.runtime ?? {};
  const agentIds = sim.agentIds ?? Object.keys(sim.runtime ?? {});
  const assassin = sim.report?.assassin;
  const hasSensitivity = !!(assassin && assassin.targetVariable && assassin.baselineOutcome && assassin.perturbedOutcome);
  const hasRounds = Array.isArray(sim.rounds) && sim.rounds.length > 0;
  const hasAgents = agentIds.length > 0;

  const selRt = selectedAgent ? snap[selectedAgent] : null;

  // Build per-variable history for selected agent
  const histories = useMemo(() => {
    const map: Record<string, number[]> = {};
    if (!selectedAgent) return map;
    CORE_VARS.forEach((k) => { map[k] = []; });
    const contradictions: number[] = [];
    const modeSeq: string[] = [];
    sim.rounds.forEach((r) => {
      const rt = r.stateSnapshot?.[selectedAgent];
      if (!rt) return;
      CORE_VARS.forEach((k) => { map[k].push(rt.core?.[k] ?? 0); });
      contradictions.push(rt.contradictionScore ?? 0);
      modeSeq.push(modeFor(rt));
    });
    (map as any).__contradictions = contradictions;
    (map as any).__modes = modeSeq;
    return map;
  }, [sim, selectedAgent]);

  // self_worth last 8 rounds per agent (for chip mini sparklines)
  function selfWorthHistory(id: string): number[] {
    const out: number[] = [];
    const start = Math.max(0, roundIdx - 7);
    for (let i = start; i <= roundIdx; i++) {
      const rt = sim!.rounds[i]?.stateSnapshot?.[id];
      if (rt) out.push(rt.core?.self_worth ?? rt.state?.self_worth ?? 0);
    }
    return out;
  }

  function inflectionsFor(id: string): { round: number; kind: string }[] {
    const out: { round: number; kind: string }[] = [];
    let prevMode: string | null = null;
    let prevAnchor: string | null = null;
    sim!.rounds.forEach((r, i) => {
      const rt = r.stateSnapshot?.[id]; if (!rt) return;
      if (rt.cascade) out.push({ round: i, kind: "cascade" });
      const m = modeFor(rt);
      if (prevMode && m !== prevMode) out.push({ round: i, kind: "mode" });
      prevMode = m;
      const aName = rt.emotionalAnchor?.name ?? null;
      if (aName && aName !== prevAnchor) out.push({ round: i, kind: "anchor" });
      prevAnchor = aName;
      if (rt.lastResolvedOutcome?.outcome === "success" && (rt.failureStreak ?? 0) === 0 && i > 0) {
        // recovery hint
      }
    });
    return out;
  }

  // Lens-weighted outcome distance for Panel 2
  const lensWeights: Record<Lens, { reputation_mean: number; inequality: number; trust_proxy: number; centralization: number }> = {
    Default: { reputation_mean: 1, inequality: 1, trust_proxy: 1, centralization: 1 },
    Equality: { reputation_mean: 0.6, inequality: 1.6, trust_proxy: 1, centralization: 0.8 },
    Trust: { reputation_mean: 0.8, inequality: 0.8, trust_proxy: 1.8, centralization: 0.6 },
    Centralization: { reputation_mean: 0.8, inequality: 1, trust_proxy: 0.6, centralization: 1.8 },
  };

  function downloadMd() {
    const a = selectedAgent ? agentMeta(selectedAgent) : null;
    const parts: string[] = [];
    parts.push(`# Nyx Outcomes Report`);
    parts.push(`\n**Simulation:** ${sim!.id}  \n**Lens:** ${lens}  \n**Selected round:** ${roundIdx + 1}/${sim!.rounds.length}\n`);
    parts.push(`\n## Timeline (Round ${roundIdx + 1})`);
    agentIds.forEach((id) => {
      const rt = snap[id]; if (!rt) return;
      parts.push(`- **${agentMeta(id).name}** — mode: ${modeFor(rt)}, self_worth: ${(rt.core?.self_worth ?? 0).toFixed(2)}`);
    });
    parts.push(`\n## Counterfactual`);
    if (hasSensitivity) {
      parts.push(`Target variable: **${assassin!.targetVariable}** (${assassin!.perturbationDirection ?? "±"} ${(assassin!.perturbationMagnitude ?? 0.2) * 100}%)`);
      parts.push(`\n| Metric | Baseline | Perturbed |`);
      parts.push(`|---|---|---|`);
      const b = assassin!.baselineOutcome!, p = assassin!.perturbedOutcome!;
      (Object.keys(b) as (keyof typeof b)[]).forEach((k) => parts.push(`| ${k} | ${b[k].toFixed(3)} | ${p[k].toFixed(3)} |`));
      parts.push(`\nSensitivity score: ${assassin!.sensitivityScore?.toFixed(3) ?? "—"}; constraint: ${assassin!.constraintClassification ?? "—"}`);
    } else {
      parts.push(`No sensitivity analysis available.`);
    }
    if (a && selRt) {
      parts.push(`\n## Agent Drill-Down — ${a.name}`);
      CORE_VARS.forEach((k) => parts.push(`- ${k}: ${(selRt.core?.[k] ?? 0).toFixed(3)}`));
      if (selRt.emotionalAnchor) parts.push(`- emotional_anchor: ${selRt.emotionalAnchor.name} (intensity ${selRt.emotionalAnchor.intensity.toFixed(2)}, valence ${selRt.emotionalAnchor.valence.toFixed(2)})`);
    }
    // Narrative timeline summary (cascade / recovery / mode shifts / anchors / assassin)
    parts.push(`\n## Narrative Timeline`);
    const prevMode: Record<string, string> = {};
    const prevAnchor: Record<string, string | null> = {};
    const prevCascade: Record<string, boolean> = {};
    sim!.rounds.forEach((r, i) => {
      Object.entries(r.stateSnapshot ?? {}).forEach(([id, rt]: any) => {
        const m = (rt.lastIntent?.type ?? rt.modeV5 ?? rt.mode ?? "EXECUTE").toString().toUpperCase();
        if (prevMode[id] && prevMode[id] !== m) parts.push(`- R${i + 1} **${agentMeta(id).name}** mode: ${prevMode[id]} → ${m}`);
        prevMode[id] = m;
        if (rt.cascade && !prevCascade[id]) parts.push(`- R${i + 1} ⚠ **${agentMeta(id).name}** cascade triggered`);
        prevCascade[id] = !!rt.cascade;
        const an = rt.emotionalAnchor?.name ?? null;
        if (an && prevAnchor[id] !== an) parts.push(`- R${i + 1} ❖ **${agentMeta(id).name}** anchor: ${an} (i=${rt.emotionalAnchor.intensity.toFixed(2)}, v=${rt.emotionalAnchor.valence.toFixed(2)})`);
        prevAnchor[id] = an;
      });
    });
    if (assassin?.assumption) parts.push(`- ✶ BlackSwan: ${assassin.assumption} — ${assassin.whyFragile ?? ""}`);
    // Variable importance highlights
    parts.push(`\n## Variable Importance Highlights`);
    const perVar: Record<string, { sum: number; n: number }> = {};
    agentIds.forEach((id) => {
      CORE_VARS.forEach((v) => {
        const series: number[] = [];
        sim!.rounds.forEach((r) => { const rt = r.stateSnapshot?.[id]; if (rt?.core) series.push((rt.core as any)[v] ?? 0); });
        const m = series.reduce((s, x) => s + x, 0) / Math.max(1, series.length);
        const va = series.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, series.length);
        perVar[v] ||= { sum: 0, n: 0 }; perVar[v].sum += va; perVar[v].n += 1;
      });
    });
    const ranked = Object.entries(perVar).map(([k, v]) => ({ k, avg: v.sum / Math.max(1, v.n) })).sort((a, b) => b.avg - a.avg);
    parts.push(`- Most volatile: **${ranked[0]?.k ?? "—"}** (variance ${ranked[0]?.avg.toFixed(4) ?? "—"})`);
    parts.push(`- Most stable: **${ranked[ranked.length - 1]?.k ?? "—"}** (variance ${ranked[ranked.length - 1]?.avg.toFixed(4) ?? "—"})`);
    if (hasSensitivity) parts.push(`- Sensitivity-dominant: **${assassin!.targetVariable}**`);
    const blob = new Blob([parts.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `nyx-outcomes-${sim!.id}.md`; link.click();
    URL.revokeObjectURL(url);
    toast.success("Outcomes report downloaded");
  }

  return (
    <PageShell title="Outcomes" subtitle={`Lens · ${lens}`}>
      {/* Top controls */}
      <div className="glass rounded-2xl p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <select
            value={lens}
            onChange={(e) => setLens(e.target.value as Lens)}
            className="rounded-xl bg-white/70 px-2.5 py-1 text-[11px] font-mono outline-none ring-1 ring-border focus:ring-primary/40"
          >
            {LENSES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" className="h-8 rounded-xl" onClick={() => setPlaying((p) => !p)}>
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              <span className="ml-1 text-[10px] uppercase tracking-wider">{playing ? "Pause" : "Replay"}</span>
            </Button>
            <Button size="sm" variant="ghost" className="h-8 rounded-xl" onClick={downloadMd}>
              <Download className="h-3.5 w-3.5" />
              <span className="ml-1 text-[10px] uppercase tracking-wider">Export</span>
            </Button>
          </div>
        </div>

        {/* Round selectors */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
          {sim.rounds.map((_, i) => (
            <button
              key={i}
              onClick={() => setRoundIdx(i)}
              className={cn(
                "shrink-0 rounded-xl px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition",
                i === roundIdx ? "bg-primary text-primary-foreground" : "bg-white/60 text-foreground/70 hover:bg-white/80"
              )}
            >
              Round {i + 1}
            </button>
          ))}
        </div>
      </div>

      {libError && (
        <div className="glass rounded-2xl p-2 text-[10px] font-mono text-primary">
          ⚠ {libError} not installed. Falling back to simple text view.
        </div>
      )}

      {/* 60/40 split: stacks on mobile */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        {/* Left column 60% */}
        <div className="space-y-3 md:col-span-3">
          {/* Panel 1 — Timeline Explorer */}
          <PanelErrorBoundary name="Timeline Explorer">
            {!hasAgents || !hasRounds ? (
              <PanelPlaceholder name={`Timeline · Round ${roundIdx + 1}`} message="No data available" />
            ) : (
              <section className="glass rounded-2xl p-3">
                <header className="mb-2 flex items-center justify-between">
                  <h2 className="font-display text-base font-semibold">Timeline · Round {roundIdx + 1}</h2>
                  <span className="font-mono text-[10px] text-muted-foreground">t = {roundIdx * 10}m</span>
                </header>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {agentIds.map((id) => {
                    const rt = snap[id]; if (!rt) return null;
                    const m = modeFor(rt);
                    const color = MODE_COLOR[m] ?? "#999";
                    const inf = inflectionsFor(id);
                    const sw = selfWorthHistory(id);
                    const a = agentMeta(id);
                    return (
                      <button
                        key={id}
                        onClick={() => setSelectedAgent(id)}
                        className={cn(
                          "rounded-xl bg-white/60 p-2 text-left transition hover:bg-white/85",
                          selectedAgent === id && "ring-2 ring-primary/40"
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                          <span className="truncate text-[11px] font-semibold">{a.name}</span>
                        </div>
                        <div className="mt-1 flex items-end justify-between gap-1">
                          <Sparkline values={sw} color={color} width={70} height={20} />
                          <div className="flex gap-0.5">
                            {inf.slice(-3).map((x, idx) => (
                              <span
                                key={idx}
                                title={`${x.kind} @ R${x.round + 1}`}
                                className="inline-block h-1.5 w-1.5 rotate-45"
                                style={{ background: x.kind === "cascade" ? "#C26B6B" : x.kind === "anchor" ? "#A77BC2" : "#C8A97E" }}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="mt-0.5 font-mono text-[9px] text-muted-foreground">{m}</div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
          </PanelErrorBoundary>

          {/* Panel 2 — Counterfactual Branches */}
          <PanelErrorBoundary name="Counterfactual">
            {hasSensitivity ? (
              <CounterfactualPanel sim={sim} lens={lens} weights={lensWeights[lens]} />
            ) : (
              <PanelPlaceholder name="Counterfactual" message="Run Sensitivity Analysis to see counterfactual branches." />
            )}
          </PanelErrorBoundary>
        </div>

        {/* Right column 40% */}
        <div className="space-y-3 md:col-span-2">
          {/* Panel 3 — Agent Drill-Down */}
          <PanelErrorBoundary name="Agent Drill-Down">
            {!selectedAgent || !hasRounds ? (
              <PanelPlaceholder name="Agent Drill-Down" message="No data available" />
            ) : (
              <AgentDrillDown sim={sim} agentId={selectedAgent} histories={histories} />
            )}
          </PanelErrorBoundary>

          {/* Panel 4 — Leverage Map (react-force-graph-2d) */}
          <PanelErrorBoundary name="Leverage Map">
            {!hasAgents ? (
              <PanelPlaceholder name="Leverage Map" message="No data available" />
            ) : libError === "react-force-graph-2d" ? (
              <section className="glass rounded-2xl p-3">
                <h2 className="font-display text-base font-semibold">Leverage Map</h2>
                <ul className="mt-2 space-y-1 text-[11px]">
                  {agentIds.map((id) => (
                    <li key={id} className="font-mono text-muted-foreground">• {agentMeta(id).name}</li>
                  ))}
                </ul>
              </section>
            ) : (
              <LeverageForceGraph
                sim={sim}
                snap={snap}
                lens={lens}
                lensScale={(lensWeights[lens].reputation_mean + lensWeights[lens].inequality + lensWeights[lens].trust_proxy + lensWeights[lens].centralization) / 4}
              />
            )}
          </PanelErrorBoundary>
        </div>
      </div>

      {/* ───── Extended Panels (5–9) ───── */}
      <div className="space-y-3">
        <PanelErrorBoundary name="Narrative Timeline">
          {hasRounds ? <NarrativeTimelinePanel sim={sim} /> : <PanelPlaceholder name="Narrative Timeline" message="No data available" />}
        </PanelErrorBoundary>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <PanelErrorBoundary name="Sentiment Ridge">
            {hasRounds && hasAgents ? <SentimentRidgePanel sim={sim} /> : <PanelPlaceholder name="Sentiment Ridge" message="No data available" />}
          </PanelErrorBoundary>
          <PanelErrorBoundary name="Influence Sankey">
            {hasRounds && hasAgents ? <InfluenceSankeyPanel sim={sim} /> : <PanelPlaceholder name="Influence Sankey" message="No data available" />}
          </PanelErrorBoundary>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <PanelErrorBoundary name="Agent Storyline">
            {hasRounds && hasAgents ? <AgentStorylinePanel sim={sim} onSelect={(id) => setSelectedAgent(id)} /> : <PanelPlaceholder name="Agent Storyline" message="No data available" />}
          </PanelErrorBoundary>
          <PanelErrorBoundary name="Variable Heatmap">
            {hasRounds && hasAgents ? <VariableHeatmapPanel sim={sim} /> : <PanelPlaceholder name="Variable Heatmap" message="No data available" />}
          </PanelErrorBoundary>
        </div>
      </div>

    </PageShell>
  );
}

function CounterfactualPanel({ sim, lens, weights }: { sim: Simulation; lens: string; weights: Record<string, number> }) {
  const a = sim.report?.assassin;
  const has = !!(a && a.baselineOutcome && a.perturbedOutcome && a.targetVariable);
  if (!has) {
    return (
      <section className="glass rounded-2xl p-3">
        <h2 className="font-display text-base font-semibold">Counterfactual</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">Run Sensitivity Analysis to see counterfactual branches.</p>
      </section>
    );
  }
  const b = a!.baselineOutcome!, p = a!.perturbedOutcome!;
  const keys = ["reputation_mean", "inequality", "trust_proxy", "centralization"] as const;
  const winnerFlipped = (b.reputation_mean >= 0.5) !== (p.reputation_mean >= 0.5);
  const sigma = (k: typeof keys[number]) => {
    const std = Math.max(0.05, Math.abs(b[k]) * 0.2 + 0.05);
    return ((p[k] - b[k]) / std) * (weights[k] ?? 1);
  };
  return (
    <section className="glass rounded-2xl p-3">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-base font-semibold">Counterfactual</h2>
        {winnerFlipped && (
          <span className="rounded-full bg-[oklch(0.93_0.06_25)] px-2 py-0.5 text-[9px] font-bold text-primary">⚠ Winner Flipped</span>
        )}
      </header>
      <div className="grid grid-cols-2 gap-2">
        {(["Baseline", "Perturbed"] as const).map((label, ci) => (
          <div key={label} className="rounded-xl bg-white/60 p-2">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {label}{ci === 1 && a!.perturbationDirection ? ` (${a!.perturbationDirection === "up" ? "+" : "−"}20% ${a!.targetVariable})` : ""}
            </div>
            <div className="space-y-1.5">
              {keys.map((k) => {
                const v = (ci === 0 ? b[k] : p[k]);
                const s = ci === 1 ? sigma(k) : 0;
                return (
                  <div key={k}>
                    <div className="flex justify-between text-[9px] font-mono">
                      <span className="text-muted-foreground">{k}</span>
                      <span>{v.toFixed(2)}{ci === 1 && <span className={cn("ml-1", Math.abs(s) > 1 && "text-primary font-bold")}>{s >= 0 ? "+" : ""}{s.toFixed(1)}σ</span>}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/50">
                      <div className="h-full" style={{ width: `${Math.min(100, Math.max(0, v * 100))}%`, background: ci === 0 ? "#C8A97E" : "#A77BC2" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Most sensitive to <span className="font-mono font-semibold text-foreground">{a!.targetVariable}</span>
        {" "}(S = {a!.sensitivityScore?.toFixed(2) ?? "—"}σ, constraint: {a!.constraintClassification ?? "unclassified"}, lens: {lens})
      </p>
    </section>
  );
}

function AgentDrillDown({ sim, agentId, histories }: { sim: Simulation; agentId: string | null; histories: Record<string, any> }) {
  if (!agentId) return <section className="glass rounded-2xl p-3"><p className="text-[11px] text-muted-foreground">Select an agent</p></section>;
  const last = sim.rounds[sim.rounds.length - 1]?.stateSnapshot?.[agentId];
  const rt = last;
  const a = NYX_AGENTS.find((x) => x.id === agentId);
  if (!rt || !a) return null;
  const m = (rt.lastIntent?.type ?? rt.modeV5 ?? rt.mode) as string;
  const modes: string[] = histories.__modes ?? [];
  const cs: number[] = histories.__contradictions ?? [];
  const cascadeRound = sim.rounds.findIndex((r) => r.stateSnapshot?.[agentId]?.cascade);
  const hardDis = sim.rounds.findIndex((r) => r.stateSnapshot?.[agentId]?.hardDissonanceTriggered);
  return (
    <section className="glass rounded-2xl p-3">
      <header className="mb-2 flex items-center gap-2">
        <span className="text-2xl">{a.avatar}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold">{a.name}</div>
          <div className="truncate text-[10px] text-muted-foreground">{a.role}</div>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
          style={{ background: MODE_COLOR[m] ?? "#999", color: "#fff" }}
        >{m}</span>
      </header>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {CORE_VARS.map((k) => (
          <div key={k} className="rounded-lg bg-white/60 p-1.5">
            <div className="truncate text-[8px] font-mono text-muted-foreground">{k}</div>
            <Sparkline values={histories[k] ?? []} color="#C8A97E" width={62} height={16} />
            <div className="text-right font-mono text-[9px]">{(rt.core?.[k] ?? 0).toFixed(2)}</div>
          </div>
        ))}
      </div>
      {cs.some((v) => v > 0) && (
        <div className="mt-2 rounded-lg bg-white/60 p-1.5">
          <div className="text-[8px] font-mono text-muted-foreground">contradiction_score</div>
          <Sparkline values={cs} color="#C26B6B" width={200} height={20} />
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-0.5">
        {modes.map((mm, i) => (
          <span
            key={i}
            title={`R${i + 1}: ${mm}`}
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: MODE_COLOR[mm] ?? "#999" }}
          />
        ))}
      </div>
      {rt.emotionalAnchor && (
        <div className="mt-2 rounded-lg bg-white/60 p-1.5 text-[10px]">
          <span className="font-semibold">Anchor:</span> {rt.emotionalAnchor.name}
          <span className="ml-1 font-mono text-muted-foreground">
            i={rt.emotionalAnchor.intensity.toFixed(2)} v={rt.emotionalAnchor.valence.toFixed(2)}
          </span>
        </div>
      )}
      {cascadeRound >= 0 && (
        <div className="mt-1.5 text-[10px] text-primary">Cascade triggered: Round {cascadeRound + 1}</div>
      )}
      {hardDis >= 0 && (
        <div className="mt-1 text-[10px] text-primary">⚠ Belief Restructuring: Round {hardDis + 1}</div>
      )}
    </section>
  );
}

