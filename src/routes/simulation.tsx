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
      },
    });
    if (error) throw error;
    const round: Round = { index: i, director: data.director, feed: data.feed };
    setTwitter((p) => [...round.feed.filter((f) => f.platform === "twitter"), ...p]);
    setReddit((p) => [...round.feed.filter((f) => f.platform === "reddit"), ...p]);
    setDirectorNotes((p) => [...p, round.director]);
    const updated = { ...sim, rounds: [...sim.rounds, round], status: "running" as const };
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
        },
      });
      if (error) throw error;
      const updated = { ...sim, report: data.report, status: "done" as const };
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
  const map: Record<string, string> = { POST: "bg-primary/15 text-primary", COMMENT: "bg-secondary/60 text-secondary-foreground", LIKE: "bg-[oklch(0.92_0.04_25)] text-primary", REPOST: "bg-[oklch(0.9_0.04_180)] text-[oklch(0.45_0.06_180)]" };
  return map[action] ?? "bg-muted text-muted-foreground";
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
