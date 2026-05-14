import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getCurrent, saveSimulation } from "@/lib/nyx-store";
import { NYX_AGENTS } from "@/lib/nyx-agents";
import type { FeedItem, Round, Simulation } from "@/lib/nyx-types";
import { Loader2, Play, Settings2, ChevronUp, ChevronDown, Heart, Repeat2, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  initRuntime,
  applyTransitions,
  rollRandomEvents,
  rollRegressionEvent,
  rollOpportunities,
  applyRoundFeedback,
  runtimeForPrompt,
  deriveActiveLoops,
  trajectoryProbability,
  applyCompetitionRanking,
  processRoundOutcomes,
  rollMicroFailures,
  applyNetworkMultiplier,
  pathLockWarning,
  planningExecutionHint,
  successScore,
  applyV5Round,
  v5Telemetry,
  setSimulationSeed,
} from "@/lib/nyx-causal";
import { deriveInsight, recordLearning } from "@/lib/nyx-learning";
import {
  autoDetectFramework,
  computeConfidence,
  CONFIDENCE_DIMENSIONS,
  FRAMEWORK_LABELS,
  FRAMEWORK_PROTOCOLS,
  SWARM_MODE_LABELS,
  type InstitutionalFramework,
  type SwarmMode,
} from "@/lib/nyx-institutional";
import type { AgentRuntime, ActiveLoop, CoreState } from "@/lib/nyx-types";
import { useNyxKernel, type Scenario, type RoundState, type OutcomeVector } from "@/hooks/useNyxKernel";
import { computeTrajectoryMetrics, VERDICT_MODE_LABELS, VERDICT_MODE_COLORS } from "@/lib/nyx-trajectory";
import { KernelVaultArchitectureCards } from "@/components/KernelVaultArchitectureCards";
import { PolarizationBenchmark } from "@/components/PolarizationBenchmark";

function hasV5(runtime?: Record<string, AgentRuntime>): boolean {
  if (!runtime) return false;
  return Object.values(runtime).some((rt) => !!rt.core);
}

export const Route = createFileRoute("/simulation")({
  head: () => ({
    meta: [
      { title: "Nyx — Simulation" },
      { name: "description", content: "Watch your strategic simulation unfold across dual streaming feeds." },
    ],
  }),
  component: SimulationPage,
});

const TOTAL_ROUNDS = 4;

function SimulationPage() {
  const nav = useNavigate();
  const [sim, setSim] = useState<Simulation | undefined>();
  const [running, setRunning] = useState(false);
  const [roundIdx, setRoundIdx] = useState(0);
  const [twitter, setTwitter] = useState<FeedItem[]>([]);
  const [reddit, setReddit] = useState<FeedItem[]>([]);
  const [directorNotes, setDirectorNotes] = useState<string[]>([]);
  const [showControls, setShowControls] = useState(false);
  const [opts, setOpts] = useState({ swarm: false, sharpTone: true, adaptive: true, enterprise: false });
  const [swarmMode, setSwarmMode] = useState<SwarmMode>("debate");
  const [framework, setFramework] = useState<InstitutionalFramework | null>(null);
  const kernel = useNyxKernel();
  const [kernelHistory, setKernelHistory] = useState<RoundState[] | null>(null);
  const [kernelOutcome, setKernelOutcome] = useState<OutcomeVector | null>(null);
  const [kernelError, setKernelError] = useState<string | null>(null);
  const [sensitivity, setSensitivity] = useState<import("@/lib/nyx-sensitivity").SensitivitySummary | null>(null);
  const [sensRunning, setSensRunning] = useState(false);
  const useKernelPath = !!sim?.advanced && kernel.ready && !kernel.error;

  useEffect(() => {
    const s = getCurrent();
    if (!s || s.agentIds.length < 2) { nav({ to: "/agents" }); return; }
    // v6.4 — auto-generate PRNG seed if missing (advanced mode); inject past insight
    let next = s;
    if (s.advanced) {
      let mutated = false;
      const patch: Partial<Simulation> = {};
      if (typeof s.prngSeed !== "number") {
        patch.prngSeed = Math.floor(Math.random() * 2 ** 31);
        mutated = true;
      }
      if (s.rounds.length === 0) {
        const insight = deriveInsight(s.seed);
        if (insight && insight !== s.pastInsight) {
          patch.pastInsight = insight;
          mutated = true;
        }
      }
      if (mutated) {
        next = { ...s, ...patch };
        saveSimulation(next);
      }
    }
    setSim(next);
    if (next.advanced) setSimulationSeed(next.prngSeed);
    // v6.7 — restore swarm mode + framework from sim if present
    if (next.swarmMode) setSwarmMode(next.swarmMode);
    if (next.swarmMode === "institutional") {
      setFramework(next.institutionalFramework ?? autoDetectFramework(next.seed));
    }
    if (next.rounds.length) {
      setRoundIdx(next.rounds.length);
      const all = next.rounds.flatMap((r) => r.feed);
      setTwitter(all.filter((f) => f.platform === "twitter"));
      setReddit(all.filter((f) => f.platform === "reddit"));
      setDirectorNotes(next.rounds.map((r) => r.director));
    }
  }, [nav]);

  async function ensureKernelRun(): Promise<RoundState[] | null> {
    if (!sim || !useKernelPath) return null;
    if (kernelHistory && kernelHistory.length >= TOTAL_ROUNDS) return kernelHistory;
    try {
      const scenario = buildKernelScenario(sim, swarmMode);
      const seed = typeof sim.prngSeed === "number" ? sim.prngSeed : 42;
      const result = await kernel.runSimulation(scenario, TOTAL_ROUNDS, seed);
      setKernelHistory(result.stateHistory);
      setKernelOutcome(result.outcomeVector);
      setKernelError(null);
      return result.stateHistory;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setKernelError(msg);
      console.warn("Kernel run failed, falling back to emulated state:", msg);
      return null;
    }
  }

  async function runRound(i: number) {
    if (!sim) return;

    // Re-seed PRNG per round for reproducibility (advanced mode only)
    if (sim.advanced && typeof sim.prngSeed === "number") {
      setSimulationSeed((sim.prngSeed + i * 0x9e3779b1) | 0);
    }

    // ---- Deterministic kernel pre-compute (advanced + kernel ready) ----
    const kHistory = useKernelPath ? await ensureKernelRun() : null;

    // ---- Advanced causal pre-round ----
    let runtime: Record<string, AgentRuntime> | undefined = sim.runtime;
    let preEvents: { agentId: string; kind: string; description: string }[] = [];
    if (sim.advanced) {
      if (!runtime) runtime = initRuntime(sim.agentIds);
      if (hasV5(runtime)) {
        // v5 — seed-based core engine
        preEvents = applyV5Round(runtime, i, TOTAL_ROUNDS, { episodicReplay: !!sim.episodicReplay });
        // === v8 Adaptive Cognition (gated, all default off) ===
        const v8 = sim.v8Flags;
        if (v8) {
          const v8mod = await import("@/lib/nyx-v8");
          if (v8.beliefModeling) v8mod.updateBeliefModeling(runtime, true);
          for (const rt of Object.values(runtime)) {
            const eventMag = Math.max(
              Math.abs(rt.dampingDiagnostics?.reputationDeltaRaw ?? 0) / 0.15,
              Math.abs(rt.dampingDiagnostics?.opportunityDeltaRaw ?? 0) / 0.20,
            );
            if (v8.iterativeSettling) v8mod.maybeIterativeSettle(rt, true, eventMag);
            if (v8.hardDissonance) v8mod.maybeHardDissonance(rt, true);
          }
        }
      } else {
        // v3/v4 fallback (toggle on but no seed-init yet)
        runtime = Object.fromEntries(
          Object.entries(runtime).map(([id, rt]) => [id, applyTransitions(rt)])
        );
        preEvents = rollRandomEvents(runtime, i);
        const regression = rollRegressionEvent(runtime, i);
        if (regression) preEvents.push(regression);
        const opps = rollOpportunities(runtime, i);
        for (const o of opps) {
          preEvents.push({ agentId: o.agentId, kind: `opportunity_${o.card.kind}`, description: o.card.description });
          if (o.card.kind === "internship" || o.card.kind === "partnership") {
            applyNetworkMultiplier(runtime, o.agentId);
          }
        }
        const microFailures = rollMicroFailures(runtime, i);
        for (const mf of microFailures) {
          preEvents.push({ agentId: mf.agentId, kind: `micro_${mf.kind}`, description: mf.description });
        }
      }

      // Overwrite runtime CoreState with deterministic kernel-computed values
      if (kHistory && runtime) {
        const round = kHistory[Math.min(i, kHistory.length - 1)];
        if (round) overwriteCoreFromKernel(runtime, round, sim.agentIds);
      }
    }

    const institutionalPayload = buildInstitutionalPayload(sim, swarmMode, framework);

    const { data, error } = await supabase.functions.invoke("nyx-ai", {
      body: {
        task: "round",
        seed: sim.seed,
        ontology: sim.ontology,
        agentIds: sim.agentIds,
        round: i + 1,
        totalRounds: TOTAL_ROUNDS,
        opts,
        prior: directorNotes,
        advanced: !!sim.advanced,
        runtime: runtime ? runtimeForPrompt(runtime) : undefined,
        events: preEvents,
        pastInsight: sim.advanced ? sim.pastInsight : undefined,
        swarmMode,
        institutional: institutionalPayload,
      },
    });
    if (error) throw error;

    // Inject random events as visible feed items
    const eventFeed: FeedItem[] = preEvents.map((ev, idx) => {
      const a = NYX_AGENTS.find((x) => x.id === ev.agentId);
      return {
        id: `ev_${i}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
        agentId: ev.agentId,
        agentName: a?.name ?? ev.agentId,
        agentAvatar: ev.kind === "mentor_comment" ? "🌟" : "📰",
        platform: idx % 2 === 0 ? "twitter" : "reddit",
        action: "POST",
        content: ev.description,
        ts: Date.now(),
        likes: 0,
        replies: 0,
        isRandomEvent: true,
        eventKind: ev.kind,
      };
    });

    const combinedFeed = [...eventFeed, ...(data.feed as FeedItem[])];

    // ---- Advanced causal post-round ----
    let stateSnapshot: Record<string, AgentRuntime> | undefined;
    if (sim.advanced && runtime) {
      if (hasV5(runtime)) {
        // v5: state already advanced in pre-round; just snapshot
        stateSnapshot = JSON.parse(JSON.stringify(runtime));
      } else {
        runtime = applyRoundFeedback(runtime, combinedFeed, i);
        processRoundOutcomes(runtime, combinedFeed, i);
        applyCompetitionRanking(runtime);
        stateSnapshot = JSON.parse(JSON.stringify(runtime));
      }
    }

    const round: Round = {
      index: i,
      director: data.director,
      feed: combinedFeed,
      stateSnapshot,
      events: preEvents,
    };
    setTwitter((p) => [...round.feed.filter((f) => f.platform === "twitter"), ...p]);
    setReddit((p) => [...round.feed.filter((f) => f.platform === "reddit"), ...p]);
    setDirectorNotes((p) => [...p, round.director]);
    const updated: Simulation = {
      ...sim,
      rounds: [...sim.rounds, round],
      status: "running",
      runtime: runtime ?? sim.runtime,
      swarmMode,
      institutionalFramework: swarmMode === "institutional" ? framework : null,
    };
    setSim(updated); saveSimulation(updated);
  }

  async function runAll() {
    if (!sim) return;
    setRunning(true);
    try {
      for (let i = roundIdx; i < TOTAL_ROUNDS; i++) {
        setRoundIdx(i + 1);
        await runRound(i);
      }
      toast.success("Simulation complete");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Simulation failed");
    } finally { setRunning(false); }
  }

  async function finish() {
    if (!sim) return;
    setRunning(true);
    try {
      const institutionalPayload = buildInstitutionalPayload(sim, swarmMode, framework);
      const trajectory =
        useKernelPath && kernelHistory && kernelOutcome
          ? computeTrajectoryMetrics(kernelHistory, kernelOutcome)
          : null;
      const { data, error } = await supabase.functions.invoke("nyx-ai", {
        body: {
          task: "report", seed: sim.seed, ontology: sim.ontology,
          agentIds: sim.agentIds, rounds: sim.rounds,
          advanced: !!sim.advanced,
          runtime: sim.advanced && sim.runtime ? runtimeForPrompt(sim.runtime) : undefined,
          swarmMode,
          institutional: institutionalPayload,
          trajectory: trajectory ?? undefined,
        },
      });
      if (error) throw error;
      let report = data.report;
      if (sim.advanced) {
        const { analyzeLoops } = await import("@/lib/nyx-causal");
        report = { ...report, loopAnalysis: analyzeLoops(sim.rounds) };
        // v6.7 — recompute confidence from multi-dimensional breakdown
        const cb = report.confidenceBreakdown;
        if (cb && typeof cb.structuralFeasibility === "number") {
          const fw = swarmMode === "institutional" ? framework : null;
          const recomputed = computeConfidence({
            structuralFeasibility: cb.structuralFeasibility,
            stakeholderAlignment: cb.stakeholderAlignment,
            riskExposure: cb.riskExposure,
            evidenceStrength: cb.evidenceStrength,
            framework: fw,
          });
          report = {
            ...report,
            confidence: recomputed,
            confidenceBreakdown: { ...cb, framework: fw ?? null },
          };
        }
        // BlackSwan Assassin — runs once after ~65% of rounds completed
        try {
          const cutoff = Math.floor(TOTAL_ROUNDS * 0.65);
          const assassinRounds = sim.rounds.slice(0, Math.max(cutoff, 1));
          const { data: aData } = await supabase.functions.invoke("nyx-ai", {
            body: {
              task: "assassin",
              seed: sim.seed,
              rounds: assassinRounds.map((r) => ({ index: r.index, director: r.director })),
              runtime: sim.runtime ? runtimeForPrompt(sim.runtime) : undefined,
            },
          });
          if (aData?.assassin) {
            let assassin = aData.assassin;
            try {
              const { runDivergence, coerceCoreVar } = await import("@/lib/nyx-divergence");
              const tv = coerceCoreVar(assassin.targetVariable) ?? "reputation";
              const dir: "up" | "down" = assassin.perturbationDirection === "down" ? "down" : "up";
              if (sim.runtime) {
                const div = runDivergence(sim.runtime, tv, dir, Math.min(6, Math.max(2, sim.rounds.length || 4)));
                assassin = {
                  ...assassin,
                  targetVariable: tv,
                  perturbationDirection: dir,
                  perturbationMagnitude: div.perturbationMagnitude,
                  baselineOutcome: div.baselineOutcome,
                  perturbedOutcome: div.perturbedOutcome,
                  outcomeDistance: div.outcomeDistance,
                  sensitivityScore: div.sensitivityScore,
                  sigmaShift: div.sigmaShift,
                  cascadePath: div.cascadePath,
                  constraintClassification: div.classification,
                };
              }
            } catch (err) { console.warn("divergence failed", err); }
            report = { ...report, assassin };
          }
        } catch (err) {
          console.warn("assassin failed", err);
        }
      }
      const updated = {
        ...sim,
        report,
        status: "done" as const,
        swarmMode,
        institutionalFramework: swarmMode === "institutional" ? framework : null,
      };
      saveSimulation(updated);
      if (sim.advanced) recordLearning(updated, report);
      nav({ to: "/report" });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Report failed");
    } finally { setRunning(false); }
  }

  const done = roundIdx >= TOTAL_ROUNDS;

  return (
    <PageShell title="Simulation" subtitle={`Round ${Math.min(roundIdx, TOTAL_ROUNDS)} of ${TOTAL_ROUNDS}`}>
      <div className="glass rounded-[20px] p-3">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="font-mono text-muted-foreground">{sim?.id.slice(0, 12)}</span>
          <span className="flex items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5 rounded-full", running ? "bg-[oklch(0.74_0.05_180)] animate-pulse-soft" : "bg-muted-foreground/40")} />
            <span className="text-muted-foreground">{running ? "live" : done ? "ready" : "idle"}</span>
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full gradient-rose transition-all" style={{ width: `${(roundIdx / TOTAL_ROUNDS) * 100}%` }} />
        </div>
      </div>

      {/* Kernel status (advanced mode only) */}
      {sim?.advanced && (
        <KernelHeader
          loading={kernel.loading}
          active={useKernelPath && !kernelError}
          unavailable={!!(kernel.error || kernelError)}
          seed={sim.prngSeed ?? 42}
          outcome={kernelOutcome}
          history={kernelHistory}
        />
      )}
      <div className="glass rounded-[22px]">
        <button
          onClick={() => setShowControls((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
        >
          <span className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-primary" /> Controls</span>
          {showControls ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {showControls && (
          <div className="space-y-3 px-4 pb-4">
            {([
              ["swarm", "Swarm Mode"],
              ["sharpTone", "Sharp Tone"],
              ["adaptive", "Adaptive Depth"],
              ["enterprise", "Enterprise Mode"],
            ] as const).map(([k, label]) => (
              <div key={k} className="flex items-center justify-between text-sm">
                <span>{label}</span>
                <Switch checked={opts[k]} onCheckedChange={(v) => setOpts({ ...opts, [k]: v })} />
              </div>
            ))}

            {sim?.advanced && (
              <>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>Swarm Mode</span>
                  <select
                    value={swarmMode}
                    onChange={(e) => {
                      const v = e.target.value as SwarmMode;
                      setSwarmMode(v);
                      if (v === "institutional" && !framework && sim) {
                        setFramework(autoDetectFramework(sim.seed));
                      }
                    }}
                    className="rounded-full bg-white/70 px-3 py-1 text-xs outline-none"
                  >
                    {(Object.keys(SWARM_MODE_LABELS) as SwarmMode[]).map((m) => (
                      <option key={m} value={m}>{SWARM_MODE_LABELS[m]}</option>
                    ))}
                  </select>
                </div>
                {swarmMode === "institutional" && (
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex flex-col">
                      <span>Framework</span>
                      <span className="text-[10px] text-muted-foreground">auto: {FRAMEWORK_LABELS[autoDetectFramework(sim.seed)]}</span>
                    </span>
                    <select
                      value={framework ?? autoDetectFramework(sim.seed)}
                      onChange={(e) => setFramework(e.target.value as InstitutionalFramework)}
                      className="rounded-full bg-white/70 px-3 py-1 text-xs outline-none"
                    >
                      {(Object.keys(FRAMEWORK_LABELS) as InstitutionalFramework[]).map((f) => (
                        <option key={f} value={f}>{FRAMEWORK_LABELS[f]}</option>
                      ))}
                    </select>
                  </div>
                )}
                {swarmMode === "institutional" && framework && (
                  <div className="rounded-2xl bg-secondary/40 px-3 py-2 text-[10px]">
                    <div className="font-semibold uppercase tracking-wider text-primary">Protocol</div>
                    <div className="mt-0.5 leading-snug text-muted-foreground">{FRAMEWORK_PROTOCOLS[framework].protocol}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {FRAMEWORK_PROTOCOLS[framework].roles.map((r, i) => (
                        <span key={i} className="rounded-full bg-white/70 px-1.5 py-0.5 font-mono text-[9px]">{r}</span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Director */}
      {directorNotes.length > 0 && (
        <div className="glass rounded-[22px] p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">Director · Round {directorNotes.length}</div>
          <p className="mt-1 text-sm leading-relaxed">{directorNotes[directorNotes.length - 1]}</p>
        </div>
      )}

      {/* Past-run insight (advanced only) */}
      {sim?.advanced && sim.pastInsight && (
        <div className="glass rounded-[22px] p-3 ring-1 ring-[oklch(0.92_0.04_70)]">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">Past-run insight</div>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">{sim.pastInsight}</p>
        </div>
      )}

      {/* v8 Adaptive Cognition — experimental panel */}
      {sim?.advanced && sim.v8Flags && (
        <V8Panel sim={sim} setSim={setSim} />
      )}

      {/* Architectural validation cards (Advanced only) */}
      {sim?.advanced && (
        <KernelVaultArchitectureCards
          v8Active={!!sim.v8Flags?.oasis}
          oasisEndpoint={sim.v8Flags?.oasisEndpoint}
        />
      )}

      {/* Polarization Benchmark — Prophet (Sci. Reports 2025) calibration */}
      {sim?.advanced && <PolarizationBenchmark />}

      {/* Sensitivity & Damping Diagnostics — Advanced only */}
      {sim?.advanced && sim.runtime && hasV5(sim.runtime) && (
        <div className="glass rounded-[22px] p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
              Sensitivity · Damping
            </div>
            <button
              type="button"
              disabled={sensRunning}
              onClick={async () => {
                if (!sim?.runtime) return;
                setSensRunning(true);
                await new Promise((r) => setTimeout(r, 0));
                try {
                  const { runSensitivityAnalysis } = await import("@/lib/nyx-sensitivity");
                  const summary = runSensitivityAnalysis(sim.runtime, Math.min(6, Math.max(2, sim.rounds.length || 4)));
                  setSensitivity(summary);
                } catch (e) {
                  toast.error("Sensitivity analysis failed");
                } finally {
                  setSensRunning(false);
                }
              }}
              className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground disabled:opacity-50"
            >
              {sensRunning ? "Analyzing…" : sensitivity ? "Re-run" : "Run analysis"}
            </button>
          </div>
          {!sensitivity ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              Probe each core variable with three replays (S_pre_cap, S_raw, S_damped) to expose
              cap-, network-, or modulation-limited dynamics. Aligned outcome vectors.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-1.5">
                <div className="rounded-xl bg-secondary/40 px-2 py-1.5">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Damping atten.</div>
                  <div className="font-mono text-sm tabular-nums">{sensitivity.damping_attenuation_factor.toFixed(2)}</div>
                </div>
                <div className="rounded-xl bg-secondary/40 px-2 py-1.5">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Damping ratio</div>
                  <div className={cn("font-mono text-sm tabular-nums", sensitivity.overDamped && "text-primary font-bold")}>
                    {sensitivity.damping_ratio.toFixed(3)}
                  </div>
                </div>
                <div className="rounded-xl bg-secondary/40 px-2 py-1.5">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Max sens. loss</div>
                  <div className={cn("font-mono text-sm tabular-nums", sensitivity.max_sensitivity_loss > 5 && "text-primary font-bold")}>
                    {sensitivity.max_sensitivity_loss === Infinity ? "∞" : sensitivity.max_sensitivity_loss.toFixed(2)}×
                  </div>
                </div>
              </div>
              {sensitivity.overDamped && (
                <div className="rounded-xl bg-[oklch(0.93_0.06_25)] px-2 py-1.5 text-[11px] font-medium text-primary">
                  ⚠ System may be over-damped (mean |S_damped| &lt; 0.5)
                </div>
              )}
              {sensitivity.suppressedVars.length > 0 && (
                <div className="rounded-xl bg-[oklch(0.92_0.07_55)] px-2 py-1.5 text-[11px] text-primary">
                  ⚠ High-value signal suppressed: <span className="font-mono font-semibold">{sensitivity.suppressedVars.join(", ")}</span>
                </div>
              )}
              <div className="overflow-hidden rounded-xl bg-white/70">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="bg-secondary/40 text-left">
                      <th className="px-2 py-1 font-semibold uppercase tracking-wider text-muted-foreground">Var</th>
                      <th className="px-1 py-1 font-semibold uppercase tracking-wider text-muted-foreground">S_pre</th>
                      <th className="px-1 py-1 font-semibold uppercase tracking-wider text-muted-foreground">S_raw</th>
                      <th className="px-1 py-1 font-semibold uppercase tracking-wider text-muted-foreground">S_damp</th>
                      <th className="px-2 py-1 font-semibold uppercase tracking-wider text-muted-foreground">Limit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sensitivity.rows.map((row) => {
                      const labelColor =
                        row.classification === "cap-limited" ? "bg-[oklch(0.92_0.06_25)] text-primary" :
                        row.classification === "network-limited" ? "bg-[oklch(0.93_0.04_300)] text-primary" :
                        row.classification === "modulation-limited" ? "bg-[oklch(0.92_0.07_55)] text-primary" :
                        "bg-secondary/60 text-secondary-foreground";
                      return (
                        <tr key={row.variable} className="border-t border-secondary/40 font-mono tabular-nums">
                          <td className="px-2 py-1 font-semibold">{row.variable}</td>
                          <td className="px-1 py-1">{row.S_pre_cap.toFixed(3)}</td>
                          <td className="px-1 py-1">{row.S_raw.toFixed(3)}</td>
                          <td className="px-1 py-1">{row.S_damped.toFixed(3)}</td>
                          <td className="px-2 py-1">
                            <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider", labelColor)}>
                              {row.classification === "unconstrained" ? "—" : row.classification.replace("-limited", "")}
                            </span>
                            {row.highValueSuppressed && (
                              <span className="ml-1 text-[9px] text-primary">×{row.ratio_pre_to_damped.toFixed(1)}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* v5 Telemetry Hub — replaces v4 panels when seed-init is active */}
      {sim?.advanced && sim.runtime && hasV5(sim.runtime) && (
        <div className="glass rounded-[22px] p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
              Advanced Telemetry · v5
            </div>
            <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-secondary-foreground">
              Causal
            </span>
          </div>
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {Object.values(sim.runtime).map((rt) => {
              const t = v5Telemetry(rt, sim.runtime);
              const a = NYX_AGENTS.find((x) => x.id === rt.agentId);
              const modeColor =
                t.mode === "collapse" ? "bg-[oklch(0.92_0.06_25)] text-primary" :
                t.mode === "fragile" ? "bg-[oklch(0.94_0.05_25)] text-primary" :
                t.mode === "spike" ? "bg-[oklch(0.92_0.07_55)] text-primary" :
                t.mode === "avoid" ? "bg-[oklch(0.93_0.04_300)] text-primary" :
                t.mode === "growth" ? "bg-[oklch(0.9_0.05_180)] text-[oklch(0.4_0.06_180)]" :
                t.mode === "recovery" ? "bg-[oklch(0.92_0.04_70)] text-primary" :
                "bg-secondary/60 text-secondary-foreground";
              return (
                <div key={rt.agentId} className="rounded-2xl bg-white/70 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 truncate">
                      <span>{a?.avatar}</span>
                      <span className="truncate text-xs font-semibold">{a?.name}</span>
                    </div>
                    <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider", modeColor)}>
                      {t.mode}
                    </span>
                  </div>
                  {t.cascade && (
                    <div className="mt-1.5 rounded-xl bg-[oklch(0.93_0.06_25)] px-2 py-1 text-[10px] font-medium text-primary">
                      ⚠ Cascade active — withdrawal compounding
                    </div>
                  )}
                  <V5Bar label="Momentum" v={t.momentum} tone="primary" />
                  <V5Bar label="Fragility" v={t.fragility} tone={t.fragility > 0.6 ? "warn" : "muted"} />
                  <V5Bar label="Identity Conflict" v={t.identityConflict} tone={t.identityConflict > 0.4 ? "warn" : "muted"} />
                  <V5Bar label="Time Pressure" v={t.timePressure} tone="muted" />
                  <V5Bar label="Phenom. Penetration" v={t.phenomenologicalPenetration} tone="muted" />
                  {t.topRelevant.length > 0 && (
                    <div className="mt-1.5">
                      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Most Relevant Others</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {t.topRelevant.map((r) => {
                          const ag = NYX_AGENTS.find((x) => x.id === r.id);
                          return (
                            <span key={r.id} className="rounded-full bg-secondary/60 px-1.5 py-0.5 text-[9px] font-mono text-secondary-foreground">
                              {ag?.avatar} {ag?.name?.split(" ")[0] ?? r.id} · {r.existence_value.toFixed(2)}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {(t.lastPerceivedEvent || t.lastIntent || t.lastResolvedOutcome) && (
                    <div className="mt-1.5 rounded-xl bg-secondary/40 px-2 py-1.5">
                      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Bridge</div>
                      {t.lastPerceivedEvent && (
                        <div className="mt-0.5 text-[10px] leading-snug">
                          <span className="font-semibold">Felt:</span> {t.lastPerceivedEvent.kind} ({t.lastPerceivedEvent.perceived.toFixed(2)} of {t.lastPerceivedEvent.raw.toFixed(2)})
                          {t.lastPerceivedEvent.sourceId && (() => {
                            const src = NYX_AGENTS.find((x) => x.id === t.lastPerceivedEvent!.sourceId);
                            return <> · from {src?.avatar}{src?.name?.split(" ")[0] ?? t.lastPerceivedEvent!.sourceId}</>;
                          })()}
                        </div>
                      )}
                      {t.lastIntent && (() => {
                        const tgt = t.lastIntent.targetId ? NYX_AGENTS.find((x) => x.id === t.lastIntent!.targetId) : null;
                        return (
                          <div className="mt-0.5 text-[10px] leading-snug">
                            <span className="font-semibold">Intent:</span> {t.lastIntent.type} · str {t.lastIntent.strength.toFixed(2)}
                            {tgt && <> → {tgt.avatar}{tgt.name?.split(" ")[0]}</>}
                          </div>
                        );
                      })()}
                      {t.lastResolvedOutcome && (
                        <div className="mt-0.5 text-[10px] leading-snug">
                          <span className="font-semibold">Resolved:</span> {t.lastResolvedOutcome.intentType} → {t.lastResolvedOutcome.outcome} (eff {t.lastResolvedOutcome.effectiveSuccess.toFixed(2)})
                        </div>
                      )}
                      {typeof t.contradictionScore === "number" && (
                        <div className="mt-1">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="font-semibold">Dissonance</span>
                            <span className="font-mono text-muted-foreground">{t.contradictionScore.toFixed(2)}</span>
                          </div>
                          <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-secondary/60">
                            <div className="h-full bg-primary/70" style={{ width: `${Math.round(t.contradictionScore * 100)}%` }} />
                          </div>
                          {t.topOpposingSources && t.topOpposingSources.length === 2 && (() => {
                            const a1 = NYX_AGENTS.find((x) => x.id === t.topOpposingSources![0]);
                            const a2 = NYX_AGENTS.find((x) => x.id === t.topOpposingSources![1]);
                            return (
                              <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                                Opposing: {a1?.avatar}{a1?.name?.split(" ")[0]} ↔ {a2?.avatar}{a2?.name?.split(" ")[0]}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  )}
                  {t.dampingDiagnostics && (
                    <div className="mt-1.5 rounded-xl bg-secondary/30 px-2 py-1.5">
                      <div className="flex items-center justify-between">
                        <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Damping · Stabilization
                        </div>
                        {t.lastIntentExplored && (
                          <span className="rounded-full bg-[oklch(0.92_0.07_55)] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-primary">
                            ε-explore
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[10px] font-mono leading-snug">
                        <div className="flex items-center justify-between">
                          <span>Δ rep</span>
                          <span className={cn(
                            "tabular-nums",
                            t.dampingDiagnostics.reputationClamped ? "text-primary font-bold" : "text-muted-foreground"
                          )}>
                            {t.dampingDiagnostics.reputationDeltaCapped >= 0 ? "+" : ""}
                            {t.dampingDiagnostics.reputationDeltaCapped.toFixed(3)}
                            {t.dampingDiagnostics.reputationClamped && (
                              <> <span className="text-[9px]">(raw {t.dampingDiagnostics.reputationDeltaRaw >= 0 ? "+" : ""}{t.dampingDiagnostics.reputationDeltaRaw.toFixed(3)})</span></>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Δ opp</span>
                          <span className={cn(
                            "tabular-nums",
                            t.dampingDiagnostics.opportunityClamped ? "text-primary font-bold" : "text-muted-foreground"
                          )}>
                            {t.dampingDiagnostics.opportunityDeltaCapped >= 0 ? "+" : ""}
                            {t.dampingDiagnostics.opportunityDeltaCapped.toFixed(3)}
                            {t.dampingDiagnostics.opportunityClamped && (
                              <> <span className="text-[9px]">(raw {t.dampingDiagnostics.opportunityDeltaRaw >= 0 ? "+" : ""}{t.dampingDiagnostics.opportunityDeltaRaw.toFixed(3)})</span></>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                  {t.customVars.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {t.customVars.map((cv, idx) => (
                        <span key={idx} className="rounded-full bg-secondary/60 px-1.5 py-0.5 text-[9px] font-mono text-secondary-foreground">
                          {cv.name} {cv.value.toFixed(2)} → {cv.affects}
                        </span>
                      ))}
                    </div>
                  )}
                  {sim?.episodicReplay && (
                    <div className="mt-1.5 rounded-xl bg-secondary/30 px-2 py-1.5">
                      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Episodic Memory</div>
                      {(!rt.episodicBuffer || rt.episodicBuffer.length === 0) ? (
                        <div className="mt-0.5 text-[10px] italic text-muted-foreground">No salient memories yet.</div>
                      ) : (
                        <div className="mt-1 space-y-1">
                          {rt.episodicBuffer.map((tr, idx) => {
                            const replayed = rt.lastReplayedTraceRound === tr.round;
                            return (
                              <div
                                key={idx}
                                className={cn(
                                  "rounded-lg px-1.5 py-1 text-[10px] font-mono leading-snug",
                                  replayed ? "bg-[oklch(0.92_0.07_55)] ring-1 ring-primary/40" : "bg-white/60"
                                )}
                              >
                                <div className="flex items-center gap-1.5">
                                  <span className="tabular-nums text-muted-foreground">r{tr.round + 1}</span>
                                  <span className={cn(
                                    "rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider",
                                    tr.event_type === "cascade" ? "bg-[oklch(0.93_0.06_25)] text-primary" : "bg-secondary/60 text-secondary-foreground"
                                  )}>
                                    {tr.event_type === "cascade" ? "cascade" : "salient"}
                                  </span>
                                  <span className={cn(
                                    "ml-auto text-[10px] font-bold",
                                    tr.valence > 0 ? "text-[oklch(0.5_0.12_150)]" : tr.valence < 0 ? "text-primary" : "text-muted-foreground"
                                  )}>
                                    {tr.valence > 0 ? "↑" : tr.valence < 0 ? "↓" : "·"}
                                  </span>
                                  {replayed && (
                                    <span className="text-[8px] font-bold uppercase tracking-wider text-primary">replay</span>
                                  )}
                                </div>
                                <div className="mt-0.5 flex flex-wrap gap-1 text-[9px] text-muted-foreground">
                                  <span>sw {tr.snapshot.self_worth.toFixed(2)}</span>
                                  <span>ax {tr.snapshot.anxiety.toFixed(2)}</span>
                                  <span>mo {tr.snapshot.momentum.toFixed(2)}</span>
                                  <span>rp {tr.snapshot.reputation.toFixed(2)}</span>
                                  <span>op {tr.snapshot.opportunity_access.toFixed(2)}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* v4 — Competition Ranking (legacy, only when no v5 init) */}
      {sim?.advanced && sim.runtime && !hasV5(sim.runtime) && Object.keys(sim.runtime).length > 0 && (
        <div className="glass rounded-[22px] p-4">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-primary">
            Competition Ranking
          </div>
          <div className="space-y-1.5">
            {[...Object.values(sim.runtime)]
              .map((rt) => ({ rt, score: successScore(rt) }))
              .sort((a, b) => b.score - a.score)
              .map(({ rt, score }, i) => {
                const a = NYX_AGENTS.find((x) => x.id === rt.agentId);
                return (
                  <div key={rt.agentId} className="flex items-center gap-2 text-[11px]">
                    <span className="w-5 text-center font-mono font-bold text-primary tabular-nums">#{i + 1}</span>
                    <span>{a?.avatar}</span>
                    <span className="flex-1 truncate font-semibold">{a?.name}</span>
                    <div className="h-1 w-20 overflow-hidden rounded-full bg-muted">
                      <div className="h-full gradient-rose" style={{ width: `${Math.round(score * 100)}%` }} />
                    </div>
                    <span className="w-10 text-right font-mono tabular-nums text-muted-foreground">
                      {Math.round(score * 100)}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Advanced state panel (legacy v3/v4 — hidden when v5 active) */}
      {sim?.advanced && sim.runtime && !hasV5(sim.runtime) && Object.keys(sim.runtime).length > 0 && (
        <div className="glass rounded-[22px] p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
              Causal State
            </div>
            <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-secondary-foreground">
              Advanced
            </span>
          </div>
          <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
            {Object.values(sim.runtime).map((rt) => {
              const a = NYX_AGENTS.find((x) => x.id === rt.agentId);
              const lock = pathLockWarning(rt);
              const planHint = planningExecutionHint(rt);
              const lastChain = rt.causalChain && rt.causalChain.length > 0 ? rt.causalChain[rt.causalChain.length - 1] : null;
              return (
                <div key={rt.agentId} className="rounded-2xl bg-white/70 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 truncate">
                      {rt.rank ? (
                        <span className="rounded-full bg-secondary/60 px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-secondary-foreground">
                          #{rt.rank}
                        </span>
                      ) : null}
                      <span>{a?.avatar}</span>
                      <span className="truncate text-xs font-semibold">{a?.name}</span>
                    </div>
                    <span className={cn(
                      "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                      rt.mode === "support_collapse" ? "bg-[oklch(0.92_0.06_25)] text-primary" :
                      rt.mode === "optimization" ? "bg-[oklch(0.9_0.05_180)] text-[oklch(0.4_0.06_180)]" :
                      rt.mode === "avoidance" ? "bg-muted text-muted-foreground" :
                      rt.mode === "recovery" ? "bg-[oklch(0.92_0.04_70)] text-primary" :
                      "bg-secondary/60 text-secondary-foreground"
                    )}>{rt.mode}</span>
                  </div>
                  <div className="mt-1 italic text-[11px] text-muted-foreground font-display">"{rt.narrative}"</div>
                  <div className="mt-1.5 flex flex-wrap gap-1 text-[9px] font-mono">
                    <StateChip label="trust" v={rt.state.parent_trust} />
                    <StateChip label="self" v={rt.state.self_worth} />
                    <StateChip label="anx" v={rt.state.anxiety} />
                    <StateChip label="iso" v={rt.state.isolation} />
                    <StateChip label="eff" v={rt.state.effort} />
                    <StateChip label="mot" v={rt.state.intrinsic_motivation} />
                    <StateChip label="real-skl" v={rt.state.actual_skill} />
                    <StateChip label="perc-skl" v={rt.state.perceived_skill} />
                    <StateChip label="rep" v={rt.state.reputation} />
                    <StateChip label="opp" v={rt.state.opportunity_access} />
                    <StateChip label="net" v={rt.state.networking} />
                    <StateChip label="peer" v={rt.state.peer_pressure} />
                    <StateChip label="p-prs" v={rt.state.parent_pressure} />
                    <StateChip label="plan/exe" v={rt.state.planning_execution_gap} />
                    <StateChip label="depth" v={rt.state.skill_depth} />
                    <StateChip label="eng" v={rt.state.energy / 100} />
                    <StateChip label="bnt" v={rt.state.burnout / 100} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px]">
                    <span className="text-muted-foreground">Trajectory</span>
                    <div className="flex items-center gap-1.5 flex-1">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full gradient-rose" style={{ width: `${trajectoryProbability(rt.state)}%` }} />
                      </div>
                      <span className="font-mono text-[10px] tabular-nums">{trajectoryProbability(rt.state)}%</span>
                    </div>
                  </div>
                  {lastChain && (
                    <div className="mt-1.5 rounded-xl bg-secondary/30 px-2 py-1 text-[10px] font-mono leading-snug">
                      <span className="font-bold text-primary">{lastChain.action}</span>
                      <span className="mx-1">→</span>skill {lastChain.skillGain >= 0 ? "+" : ""}{lastChain.skillGain}
                      <span className="mx-1">→</span>signal {lastChain.signalDelta >= 0 ? "+" : ""}{lastChain.signalDelta}
                      <span className="mx-1">→</span>opp {lastChain.opportunityDelta >= 0 ? "+" : ""}{lastChain.opportunityDelta}
                      <span className="mx-1">→</span>rep {lastChain.reputationDelta >= 0 ? "+" : ""}{lastChain.reputationDelta}
                    </div>
                  )}
                  {(lock || planHint || rt.pathLocked) && (
                    <div className="mt-1.5 flex flex-wrap gap-1 text-[9px]">
                      {lock && (
                        <span className={cn(
                          "rounded-full px-1.5 py-0.5 font-medium",
                          rt.pathLocked ? "bg-[oklch(0.92_0.06_25)] text-primary" : "bg-[oklch(0.94_0.05_70)] text-primary"
                        )}>
                          {rt.pathLocked ? "🔒 " : "⚠ "}{lock}
                        </span>
                      )}
                      {planHint && (
                        <span className="rounded-full bg-secondary/50 px-1.5 py-0.5 font-medium text-secondary-foreground">
                          {planHint}
                        </span>
                      )}
                    </div>
                  )}
                  {rt.opportunityCards && rt.opportunityCards.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {rt.opportunityCards.slice(-3).map((c) => (
                        <span key={c.id} className="rounded-full bg-[oklch(0.94_0.05_70)] px-1.5 py-0.5 text-[9px] font-medium text-primary">
                          ✦ {c.kind}
                        </span>
                      ))}
                    </div>
                  )}
                  {rt.microFailures && rt.microFailures.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {rt.microFailures.slice(-2).map((m, idx) => (
                        <span key={idx} className="rounded-full bg-[oklch(0.93_0.05_25)] px-1.5 py-0.5 text-[9px] font-medium text-primary">
                          ⚠ {m.kind.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Active Loops */}
      {sim?.advanced && sim.rounds.length > 0 && (() => {
        const loops: ActiveLoop[] = deriveActiveLoops(sim.rounds, 3);
        if (loops.length === 0) return null;
        return (
          <div className="glass rounded-[22px] p-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-primary">
              Active Loops · last 3 rounds
            </div>
            <div className="space-y-1.5">
              {loops.map((l, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-2xl px-3 py-2 text-[11px] leading-snug",
                    l.kind === "negative"
                      ? "bg-[oklch(0.94_0.05_25)] text-primary"
                      : "bg-[oklch(0.94_0.05_180)] text-[oklch(0.4_0.06_180)]"
                  )}
                >
                  <span className="mr-1 font-bold uppercase tracking-wider text-[9px]">
                    {l.kind === "negative" ? "↓ negative" : "↑ positive"}
                  </span>
                  {l.description}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Feeds */}
      <div className="grid grid-cols-2 gap-3">
        <FeedColumn label="Twitter" items={twitter} />
        <FeedColumn label="Reddit" items={reddit} />
      </div>

      {/* Mini graph */}
      {sim && sim.graph.nodes.length > 0 && (
        <div className="glass rounded-[20px] p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Live Graph</div>
          <MiniGraph nodes={sim.graph.nodes} edges={sim.graph.edges} pulse={running} />
        </div>
      )}

      {!done ? (
        <Button
          onClick={runAll}
          disabled={running}
          className="h-12 w-full rounded-2xl gradient-rose text-primary-foreground shadow-[var(--shadow-soft)]"
        >
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          {roundIdx === 0 ? "Start Simulation" : "Resume"}
        </Button>
      ) : (
        <Button
          onClick={finish}
          disabled={running}
          className="h-12 w-full rounded-2xl gradient-rose text-primary-foreground shadow-[var(--shadow-soft)]"
        >
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Finish Simulation
        </Button>
      )}
    </PageShell>
  );
}

function buildInstitutionalPayload(
  sim: Simulation,
  swarmMode: SwarmMode,
  framework: InstitutionalFramework | null,
) {
  if (!sim.advanced || swarmMode !== "institutional" || !framework) return undefined;
  const proto = FRAMEWORK_PROTOCOLS[framework];
  const roleBindings: Record<string, string> = {};
  sim.agentIds.forEach((id, idx) => {
    roleBindings[id] = proto.roles[idx % proto.roles.length];
  });
  return {
    framework: FRAMEWORK_LABELS[framework],
    protocol: proto.protocol,
    roleBindings,
  };
}

function buildKernelScenario(sim: Simulation, swarmMode: SwarmMode): Scenario {
  const agents = sim.agentIds.map((id) => {
    const a = NYX_AGENTS.find((x) => x.id === id);
    const rt = sim.runtime?.[id];
    const c: CoreState | undefined = rt?.core;
    const initial_state: Record<string, number> = {};
    if (c) {
      initial_state.self_worth = c.self_worth;
      initial_state.anxiety = c.anxiety;
      initial_state.consistency = c.consistency;
      initial_state.momentum = c.momentum;
      initial_state.reputation = c.reputation;
      initial_state.opportunity_access = c.opportunity_access;
      initial_state.fragility_index = c.fragility_index;
      initial_state.lock_in = c.lock_in;
      initial_state.learning_rate = c.learning_rate;
      initial_state.energy = c.energy;
      initial_state.phenomenological_penetration = c.phenomenological_penetration;
    }
    return {
      name: id,
      role: a?.role ?? "agent",
      personality: a?.personality ?? "",
      initial_state,
      emotional_anchor: rt?.emotionalAnchor ?? null,
    };
  });
  // Build influence_network from graph edges (default uniform if none)
  const influence_network: Record<string, Record<string, number>> = {};
  for (const id of sim.agentIds) influence_network[id] = {};
  for (const e of sim.graph.edges) {
    if (sim.agentIds.includes(e.source) && sim.agentIds.includes(e.target)) {
      influence_network[e.source][e.target] = e.weight ?? 0.5;
    }
  }
  // Tag mode in role suffix so the kernel scenario remains JSON-only
  if (swarmMode) {
    for (const ag of agents) ag.role = `${ag.role} [${swarmMode}]`;
  }
  return { agents, influence_network };
}

function overwriteCoreFromKernel(
  runtime: Record<string, AgentRuntime>,
  round: RoundState,
  agentIds: string[],
) {
  for (const id of agentIds) {
    const snap = round.agents[id];
    const rt = runtime[id];
    if (!snap || !rt) continue;
    if (!rt.core) {
      rt.core = {
        self_worth: 0.5, anxiety: 0.3, consistency: 0.5, momentum: 0.5,
        reputation: 0.5, opportunity_access: 0.5, fragility_index: 0.3,
        lock_in: 0.2, learning_rate: 0.5, energy: 0.8,
        phenomenological_penetration: 0.6,
      };
    }
    rt.core.self_worth = snap.self_worth;
    rt.core.anxiety = snap.anxiety;
    rt.core.consistency = snap.consistency;
    rt.core.momentum = snap.momentum;
    rt.core.reputation = snap.reputation;
    rt.core.opportunity_access = snap.opportunity_access;
    rt.core.fragility_index = snap.fragility_index;
    rt.core.lock_in = snap.lock_in;
    rt.core.learning_rate = snap.learning_rate;
    rt.core.energy = snap.energy;
    if (snap.cascade_active) rt.cascade = true;
    if (typeof snap.contradiction_score === "number") {
      rt.contradictionScore = snap.contradiction_score;
    }
    // Fallback: clamp any NaN/undefined to 0.5 with a warning
    for (const k of Object.keys(rt.core) as (keyof typeof rt.core)[]) {
      const v = rt.core[k];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        console.warn(`[Engine] non-finite ${String(k)} for ${id} round ${round.round} — defaulting to 0.5`);
        rt.core[k] = 0.5;
      }
    }
  }
  // Debug: log the first agent's full state for this round
  const firstId = agentIds[0];
  if (firstId && runtime[firstId]?.core) {
    console.log(`[Engine] Round ${round.round} Agent ${firstId}:`, { ...runtime[firstId].core });
  }
}

function actionBadge(action: string) {
  const map: Record<string, string> = {
    POST: "bg-primary/15 text-primary",
    COMMENT: "bg-secondary/60 text-secondary-foreground",
    LIKE: "bg-[oklch(0.92_0.04_25)] text-primary",
    REPOST: "bg-[oklch(0.9_0.04_180)] text-[oklch(0.45_0.06_180)]",
    IDLE: "bg-muted text-muted-foreground",
    MUTE: "bg-muted text-muted-foreground",
    WITHDRAW: "bg-[oklch(0.92_0.05_25)] text-primary",
  };
  return map[action] ?? "bg-muted text-muted-foreground";
}

function V5Bar({ label, v, tone }: { label: string; v: number; tone: "primary" | "warn" | "muted" }) {
  const pct = Math.max(0, Math.min(100, Math.round(v * 100)));
  const fill =
    tone === "warn" ? "bg-[oklch(0.78_0.12_25)]" :
    tone === "primary" ? "gradient-rose" :
    "bg-muted-foreground/40";
  return (
    <div className="mt-1.5 flex items-center gap-2 text-[10px]">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full transition-all", fill)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right font-mono tabular-nums">{pct}</span>
    </div>
  );
}

function StateChip({ label, v }: { label: string; v: number }) {
  const positive = v >= 0;
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5",
        positive ? "bg-secondary/50 text-secondary-foreground" : "bg-[oklch(0.93_0.04_25)] text-primary"
      )}
    >
      {label} {v.toFixed(2)}
    </span>
  );
}

function KernelHeader({
  loading, active, unavailable, seed, outcome, history,
}: {
  loading: boolean;
  active: boolean;
  unavailable: boolean;
  seed: number;
  outcome: OutcomeVector | null;
  history: RoundState[] | null;
}) {
  const [open, setOpen] = useState(false);
  const trajectory = active && outcome && history ? computeTrajectoryMetrics(history, outcome) : null;
  const fmt = (n: number) => (n >= 0 ? `+${n.toFixed(3)}` : n.toFixed(3));
  return (
    <div className="glass rounded-[18px] px-3 py-2 text-[11px]">
      {loading && <span className="text-muted-foreground">⏳ Loading deterministic kernel…</span>}
      {active && (
        <span className="font-medium text-primary">
          ▶ Deterministic Kernel Active (seed: {seed})
        </span>
      )}
      {unavailable && (
        <span className="text-muted-foreground">
          ⚠ Kernel unavailable — using emulated state
        </span>
      )}
      {outcome && (
        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
          <span>rep μ: {outcome.reputation_mean.toFixed(3)}</span>
          <span>ineq: {outcome.inequality.toFixed(3)}</span>
          <span>trust: {outcome.trust_proxy.toFixed(3)}</span>
          <span>centr: {outcome.centralization.toFixed(3)}</span>
        </div>
      )}
      {trajectory && (
        <div className="mt-2">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-primary"
          >
            <span>Metric Trace</span>
            <span>{open ? "▾" : "▸"}</span>
          </button>
          <div className="mt-1">
            <span className={cn(
              "inline-block rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider",
              VERDICT_MODE_COLORS[trajectory.verdictMode],
            )}>
              {VERDICT_MODE_LABELS[trajectory.verdictMode]}
            </span>
          </div>
          {open && (
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
              <span>Δ trust: {fmt(trajectory.deltaTrustProxy)}</span>
              <span>Δ ineq: {fmt(trajectory.deltaInequality)}</span>
              <span>polariz: {trajectory.polarizationScore.toFixed(3)}</span>
              <span>converg: {trajectory.convergenceScore.toFixed(3)}</span>
              <span>instab: {trajectory.instabilityIndex.toFixed(3)}</span>
              <span>trend: {trajectory.dominantTrend}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FeedColumn({ label, items }: { label: string; items: FeedItem[] }) {
  return (
    <div className="glass max-h-[420px] overflow-hidden rounded-[22px] p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="max-h-[380px] space-y-2 overflow-y-auto pr-1">
        {items.length === 0 && <div className="py-6 text-center text-xs text-muted-foreground">Awaiting…</div>}
        {items.map((it) => {
          const agent = NYX_AGENTS.find((a) => a.id === it.agentId);
          return (
            <div key={it.id} className="rounded-2xl bg-white/70 p-3 animate-float-up">
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="text-base">{agent?.avatar ?? "🤖"}</span>
                  <span className="truncate text-xs font-semibold">{it.agentName}</span>
                </div>
                <span className={cn("rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider", actionBadge(it.action))}>{it.action}</span>
              </div>
              <p className="mt-1.5 font-mono text-[11px] leading-snug">{it.content}</p>
              <div className="mt-1.5 flex gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-0.5"><Heart className="h-2.5 w-2.5" />{it.likes ?? 0}</span>
                <span className="flex items-center gap-0.5"><MessageCircle className="h-2.5 w-2.5" />{it.replies ?? 0}</span>
                <span className="flex items-center gap-0.5"><Repeat2 className="h-2.5 w-2.5" /></span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniGraph({ nodes, edges, pulse }: { nodes: { id: string; group: number }[]; edges: { source: string; target: string; weight: number }[]; pulse: boolean }) {
  const W = 320, H = 140;
  const palette = ["#D4A5A5", "#E8D5B5", "#8EC0B5", "#C9A8D4", "#B5C9D4"];
  const pos = Object.fromEntries(nodes.map((n, i) => {
    const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    return [n.id, { x: W / 2 + Math.cos(a) * 55, y: H / 2 + Math.sin(a) * 55 }];
  }));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[140px] w-full">
      {edges.map((e, i) => {
        const a = pos[e.source], b = pos[e.target]; if (!a || !b) return null;
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(180,140,120,0.25)" />;
      })}
      {nodes.map((n) => {
        const p = pos[n.id]; if (!p) return null;
        return <circle key={n.id} cx={p.x} cy={p.y} r={7} fill={palette[n.group % palette.length]} className={pulse ? "animate-pulse-soft" : ""} />;
      })}
    </svg>
  );
}

function V8Panel({ sim, setSim }: { sim: Simulation; setSim: (s: Simulation) => void }) {
  const flags = sim.v8Flags ?? {};
  const [cloud, setCloud] = useState<import("@/lib/nyx-v8").CloudResult | null>(null);
  const [cloudProgress, setCloudProgress] = useState<{ done: number; total: number } | null>(null);
  const [cloudRunning, setCloudRunning] = useState(false);
  const [oasisStatus, setOasisStatus] = useState<"unknown" | "ok" | "down">("unknown");
  const [gtRunning, setGtRunning] = useState(false);

  const iters = sim.runtime ? Object.values(sim.runtime).map((rt) => rt.iterationCount ?? 0) : [];
  const maxIter = iters.length ? Math.max(...iters) : 0;
  const hardTriggered = sim.runtime ? Object.values(sim.runtime).filter((rt) => rt.hardDissonanceTriggered).map((rt) => rt.agentId) : [];

  async function runCloud() {
    if (!sim.runtime) return;
    setCloudRunning(true); setCloud(null); setCloudProgress(null);
    try {
      const { runProbabilityCloud } = await import("@/lib/nyx-v8");
      const res = await runProbabilityCloud(sim.runtime, Math.max(2, sim.rounds.length || 4), {
        runs: 30, onProgress: (d, t) => setCloudProgress({ done: d, total: t }),
      });
      if (!res) { toast.error("Cloud auto-disabled (>50 agents)"); return; }
      setCloud(res);
    } catch { toast.error("Cloud run failed"); }
    finally { setCloudRunning(false); }
  }
  async function probeOasis() {
    const { checkOasisReachable } = await import("@/lib/nyx-v8");
    const ok = await checkOasisReachable(flags.oasisEndpoint);
    setOasisStatus(ok ? "ok" : "down");
    if (!ok) toast.error("OASIS endpoint unreachable — fallback active");
  }
  async function runGameTheory() {
    setGtRunning(true);
    try {
      const { runGameTheoryAnalysis } = await import("@/lib/nyx-v8");
      const gt = await runGameTheoryAnalysis(sim);
      if (!gt) { toast.error("Game-theory analysis unavailable"); return; }
      const next = { ...sim, gameTheory: gt };
      setSim(next); saveSimulation(next);
      toast.success("Game theory ready — see report");
    } finally { setGtRunning(false); }
  }

  const any = flags.iterativeSettling || flags.probabilityCloud || flags.hardDissonance || flags.beliefModeling || flags.oasis || flags.gameTheory;
  if (!any) return null;
  return (
    <div className="glass rounded-[22px] p-4 space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">v8 Adaptive Cognition · Experimental</div>
      {flags.iterativeSettling && (
        <div className="rounded-xl bg-secondary/40 px-2.5 py-1.5 text-[11px]">
          Iterative settling · max iterations this round: <span className="font-mono font-semibold">{maxIter || 1}</span>
        </div>
      )}
      {flags.hardDissonance && hardTriggered.length > 0 && (
        <div className="rounded-xl bg-[oklch(0.92_0.06_25)] px-2.5 py-1.5 text-[11px] text-primary">
          ⚠ Experimental — hard dissonance triggered: <span className="font-mono font-semibold">{hardTriggered.join(", ")}</span>
        </div>
      )}
      {flags.beliefModeling && (
        <div className="rounded-xl bg-secondary/40 px-2.5 py-1.5 text-[11px]">
          Belief modeling active · <span className="text-muted-foreground">perceived_self_by_j tracked across {sim.runtime ? Object.keys(sim.runtime).length : 0} agents</span>
        </div>
      )}
      {flags.probabilityCloud && (
        <div className="rounded-xl bg-secondary/40 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold">Probability Cloud</span>
            <button onClick={runCloud} disabled={cloudRunning} className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground disabled:opacity-50">
              {cloudRunning ? "Running…" : cloud ? "Re-run" : "Run 30×"}
            </button>
          </div>
          {cloudRunning && cloudProgress && (
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full gradient-rose transition-all" style={{ width: `${(cloudProgress.done / cloudProgress.total) * 100}%` }} />
            </div>
          )}
          {cloud && (
            <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
              {(["reputation_mean", "inequality", "trust_proxy", "centralization"] as const).map((k) => {
                const m = cloud.byMetric[k];
                return (
                  <div key={k} className="rounded-lg bg-white/70 px-2 py-1">
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{k}</div>
                    <div>μ {m.mean.toFixed(2)} · p25–p75 [{m.p25.toFixed(2)}, {m.p75.toFixed(2)}]</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {flags.oasis && (
        <div className="rounded-xl bg-secondary/40 px-2.5 py-1.5 text-[11px] flex items-center justify-between">
          <span>OASIS · {oasisStatus === "ok" ? "✅ reachable" : oasisStatus === "down" ? "❌ fallback active" : "not probed"}</span>
          <button onClick={probeOasis} className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">Probe</button>
        </div>
      )}
      {flags.gameTheory && (
        <div className="rounded-xl bg-secondary/40 px-2.5 py-1.5 text-[11px] flex items-center justify-between">
          <span>Game Theory · {sim.gameTheory ? "✅ ready" : "not yet computed"}</span>
          <button onClick={runGameTheory} disabled={gtRunning} className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground disabled:opacity-50">
            {gtRunning ? "…" : "Analyze"}
          </button>
        </div>
      )}
    </div>
  );
}
