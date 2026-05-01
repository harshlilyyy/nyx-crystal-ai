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
} from "@/lib/nyx-causal";
import type { AgentRuntime, ActiveLoop } from "@/lib/nyx-types";

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
    setSim(s);
    if (s.rounds.length) {
      setRoundIdx(s.rounds.length);
      const all = s.rounds.flatMap((r) => r.feed);
      setTwitter(all.filter((f) => f.platform === "twitter"));
      setReddit(all.filter((f) => f.platform === "reddit"));
      setDirectorNotes(s.rounds.map((r) => r.director));
    }
  }, [nav]);

  async function runRound(i: number) {
    if (!sim) return;

    // ---- Advanced causal pre-round ----
    let runtime: Record<string, AgentRuntime> | undefined = sim.runtime;
    let preEvents: { agentId: string; kind: string; description: string }[] = [];
    if (sim.advanced) {
      if (!runtime) runtime = initRuntime(sim.agentIds);
      runtime = Object.fromEntries(
        Object.entries(runtime).map(([id, rt]) => [id, applyTransitions(rt)])
      );
      preEvents = rollRandomEvents(runtime, i);
      const regression = rollRegressionEvent(runtime, i);
      if (regression) preEvents.push(regression);
      const opps = rollOpportunities(runtime, i);
      for (const o of opps) {
        preEvents.push({ agentId: o.agentId, kind: `opportunity_${o.card.kind}`, description: o.card.description });
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
      runtime = applyRoundFeedback(runtime, combinedFeed, i);
      stateSnapshot = JSON.parse(JSON.stringify(runtime));
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
      }
      const updated = { ...sim, report, status: "done" as const };
      saveSimulation(updated);
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

      {/* Advanced state panel */}
      {sim?.advanced && sim.runtime && Object.keys(sim.runtime).length > 0 && (
        <div className="glass rounded-[22px] p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
              Causal State
            </div>
            <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-secondary-foreground">
              Advanced
            </span>
          </div>
          <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
            {Object.values(sim.runtime).map((rt) => {
              const a = NYX_AGENTS.find((x) => x.id === rt.agentId);
              return (
                <div key={rt.agentId} className="rounded-2xl bg-white/70 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 truncate">
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
                    <StateChip label="skl" v={rt.state.skill_level} />
                    <StateChip label="net" v={rt.state.networking} />
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
                  {rt.opportunityCards && rt.opportunityCards.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {rt.opportunityCards.slice(-3).map((c) => (
                        <span key={c.id} className="rounded-full bg-[oklch(0.94_0.05_70)] px-1.5 py-0.5 text-[9px] font-medium text-primary">
                          ✦ {c.kind}
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
