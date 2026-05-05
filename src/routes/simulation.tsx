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
import type { AgentRuntime, ActiveLoop } from "@/lib/nyx-types";

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
    if (next.rounds.length) {
      setRoundIdx(next.rounds.length);
      const all = next.rounds.flatMap((r) => r.feed);
      setTwitter(all.filter((f) => f.platform === "twitter"));
      setReddit(all.filter((f) => f.platform === "reddit"));
      setDirectorNotes(next.rounds.map((r) => r.director));
    }
  }, [nav]);

  async function runRound(i: number) {
    if (!sim) return;

    // Re-seed PRNG per round for reproducibility (advanced mode only)
    if (sim.advanced && typeof sim.prngSeed === "number") {
      setSimulationSeed((sim.prngSeed + i * 0x9e3779b1) | 0);
    }

    // ---- Advanced causal pre-round ----
    let runtime: Record<string, AgentRuntime> | undefined = sim.runtime;
    let preEvents: { agentId: string; kind: string; description: string }[] = [];
    if (sim.advanced) {
      if (!runtime) runtime = initRuntime(sim.agentIds);
      if (hasV5(runtime)) {
        // v5 — seed-based core engine
        preEvents = applyV5Round(runtime, i, TOTAL_ROUNDS);
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
    }

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
      const { data, error } = await supabase.functions.invoke("nyx-ai", {
        body: {
          task: "report", seed: sim.seed, ontology: sim.ontology,
          agentIds: sim.agentIds, rounds: sim.rounds,
          advanced: !!sim.advanced,
          runtime: sim.advanced && sim.runtime ? runtimeForPrompt(sim.runtime) : undefined,
        },
      });
      if (error) throw error;
      let report = data.report;
      if (sim.advanced) {
        const { analyzeLoops } = await import("@/lib/nyx-causal");
        report = { ...report, loopAnalysis: analyzeLoops(sim.rounds) };
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
          if (aData?.assassin) report = { ...report, assassin: aData.assassin };
        } catch (err) {
          console.warn("assassin failed", err);
        }
      }
      const updated = { ...sim, report, status: "done" as const };
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

      {/* Controls */}
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
                  {t.customVars.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {t.customVars.map((cv, idx) => (
                        <span key={idx} className="rounded-full bg-secondary/60 px-1.5 py-0.5 text-[9px] font-mono text-secondary-foreground">
                          {cv.name} {cv.value.toFixed(2)} → {cv.affects}
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
