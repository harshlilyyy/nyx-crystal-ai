import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getCurrent, saveSimulation } from "@/lib/nyx-store";
import type { OntologyNode, Simulation } from "@/lib/nyx-types";
import { ArrowLeft, ArrowRight, Loader2, Pencil, Trash2, Atom } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { initRuntime } from "@/lib/nyx-causal";
import { HistoricalAnchorCard } from "@/components/HistoricalAnchorCard";
import { RealWorldContextCard } from "@/components/RealWorldContextCard";

export const Route = createFileRoute("/setup")({
  head: () => ({
    meta: [
      { title: "Nyx — Setup" },
      { name: "description", content: "Seed your simulation, generate an ontology, and build the knowledge graph." },
    ],
  }),
  component: SetupPage,
});

function SetupPage() {
  const nav = useNavigate();
  const [sim, setSim] = useState<Simulation | undefined>();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [seed, setSeed] = useState("");
  const [ontology, setOntology] = useState<OntologyNode[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const s = getCurrent();
    if (!s) { nav({ to: "/" }); return; }
    setSim(s);
    setSeed(s.seed);
    setOntology(s.ontology);
    if (s.graph.nodes.length) setStep(3);
    else if (s.ontology.length) setStep(2);
  }, [nav]);

  async function generateOntology() {
    if (!seed.trim()) { toast.error("Add a seed first"); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("nyx-ai", {
        body: { task: "ontology", seed, realWorldContext: sim?.realWorldContext },
      });
      if (error) throw error;
      const items: OntologyNode[] = data.ontology ?? [];
      setOntology(items);
      const next = { ...sim!, seed, ontology: items, status: "setup" as const };
      setSim(next); saveSimulation(next);
      setStep(2);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to generate";
      toast.error(msg);
    } finally { setLoading(false); }
  }

  async function buildGraph() {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("nyx-ai", {
        body: { task: "graph", seed, ontology },
      });
      if (error) throw error;
      const next = { ...sim!, seed, ontology, graph: data.graph, status: "setup" as const };
      setSim(next); saveSimulation(next);
      setStep(3);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to build graph";
      toast.error(msg);
    } finally { setLoading(false); }
  }

  function continueToAgents() {
    if (!sim) return;
    saveSimulation({ ...sim, status: "agents" });
    nav({ to: "/agents" });
  }

  async function toggleAdvanced(v: boolean) {
    if (!sim) return;
    const next: Simulation = {
      ...sim,
      advanced: v,
      runtime: v ? (sim.runtime ?? (sim.agentIds.length ? initRuntime(sim.agentIds) : undefined)) : sim.runtime,
    };
    setSim(next);
    saveSimulation(next);
    if (v && next.seed.trim() && next.agentIds.length > 0) {
      await initAdvancedFromSeed(next);
    }
  }

  async function initAdvancedFromSeed(s: Simulation) {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("nyx-ai", {
        body: { task: "init_advanced", seed: s.seed, agentIds: s.agentIds },
      });
      if (error) throw error;
      const extracted = (data?.extracted ?? {}) as Record<string, { core?: Record<string, number>; custom?: unknown[] }>;
      const { applyExtractedInit } = await import("@/lib/nyx-causal");
      const { NYX_AGENTS } = await import("@/lib/nyx-agents");
      const baseRuntime = s.runtime ?? initRuntime(s.agentIds);
      const agentMap: Record<string, string> = {};
      for (const id of s.agentIds) {
        const a = NYX_AGENTS.find((x) => x.id === id);
        if (a) agentMap[id] = a.name;
      }
      const runtime = applyExtractedInit(baseRuntime, extracted as Parameters<typeof applyExtractedInit>[1], agentMap);
      const next = { ...s, advanced: true, runtime };
      setSim(next);
      saveSimulation(next);
      toast.success("Advanced state initialized from seed");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to initialize advanced state");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell title="Setup" subtitle="Seed → Ontology → Graph">
      <Steps step={step} onJump={(s) => setStep(s)} />

      {/* Advanced Simulation toggle */}
      <div className="glass rounded-[22px] p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-secondary/60">
              <Atom className="h-4 w-4 text-primary" />
            </span>
            <div>
              <div className="text-sm font-medium">Advanced Simulation</div>
              <div className="text-[11px] leading-snug text-muted-foreground">
                Causal modeling: state, thresholds, feedback loops, random events.
              </div>
            </div>
          </div>
          <Switch checked={!!sim?.advanced} onCheckedChange={toggleAdvanced} />
        </div>
        {sim?.advanced && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/50 px-3 py-2">
              <div className="text-[11px] leading-snug text-muted-foreground">
                {sim.agentIds.length > 0
                  ? "Initialize 10-variable agent state from your scenario."
                  : "Pick agents first, then re-initialize from seed."}
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={loading || !sim.seed.trim() || sim.agentIds.length === 0}
                onClick={() => initAdvancedFromSeed(sim)}
                className="rounded-full text-xs"
              >
                {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                Re-initialize
              </Button>
            </div>
            <div className="flex items-center gap-2 rounded-2xl bg-white/50 px-3 py-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                PRNG Seed
              </label>
              <input
                type="number"
                value={sim.prngSeed ?? ""}
                placeholder="auto"
                onChange={(e) => {
                  const v = e.target.value.trim();
                  const next = { ...sim, prngSeed: v === "" ? undefined : Number(v) };
                  setSim(next); saveSimulation(next);
                }}
                className="flex-1 rounded-xl bg-white/70 px-2 py-1 font-mono text-xs outline-none ring-1 ring-border focus:ring-primary/40"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const v = Math.floor(Math.random() * 2 ** 31);
                  const next = { ...sim, prngSeed: v };
                  setSim(next); saveSimulation(next);
                }}
                className="rounded-full text-xs"
              >
                Random
              </Button>
            </div>
            {typeof sim.prngSeed === "number" && (
              <div className="px-3 text-[10px] font-mono text-muted-foreground">
                seed = {sim.prngSeed} · simulations with this seed will replay identically
              </div>
            )}
            <div
              className="flex items-center justify-between gap-3 rounded-2xl bg-white/50 px-3 py-2"
              title="Agents remember and replay high-salience events when anxious."
            >
              <div className="flex flex-col">
                <span className="text-[11px] font-semibold">Hippocampal Memory</span>
                <span className="text-[10px] leading-snug text-muted-foreground">
                  Episodic Replay — agents recall salient past events under anxiety.
                </span>
              </div>
              <Switch
                checked={!!sim.episodicReplay}
                onCheckedChange={(v) => {
                  const next = { ...sim, episodicReplay: v };
                  setSim(next); saveSimulation(next);
                }}
              />
            </div>
            <V8Toggles sim={sim} setSim={setSim} />
            <button
              onClick={async () => {
                const { resetLearning } = await import("@/lib/nyx-learning");
                resetLearning();
                toast.success("Past learning wiped");
              }}
              className="w-full rounded-2xl bg-white/50 px-3 py-2 text-[11px] text-muted-foreground hover:bg-white/70"
            >
              Reset learning (clear past run insights)
            </button>
          </div>
        )}
      </div>

      {/* Historical Anchor — Phase 1 placeholder; gated to Advanced */}
      {sim?.advanced && <HistoricalAnchorCard />}

      {/* Real-World Context — session-only, gated to Advanced */}
      {sim?.advanced && <RealWorldContextCard sim={sim} setSim={setSim} />}


      {step === 1 && (
        <div className="glass rounded-[24px] p-5">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Seed
          </label>
          <Textarea
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="A single sentence or paragraph: a question, decision, or scenario you want to simulate."
            className="min-h-[180px] resize-none rounded-2xl border-0 bg-white/60 text-base focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          <Button
            onClick={generateOntology}
            disabled={loading || !seed.trim()}
            className="mt-4 h-12 w-full rounded-2xl gradient-rose text-primary-foreground shadow-[var(--shadow-soft)] hover:opacity-95"
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Generate Ontology
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          {ontology.map((node, i) => (
            <OntologyCard
              key={node.id}
              node={node}
              onChange={(n) => setOntology(ontology.map((x, j) => (j === i ? n : x)))}
              onDelete={() => setOntology(ontology.filter((_, j) => j !== i))}
            />
          ))}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep(1)} className="rounded-2xl">
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <Button
              onClick={buildGraph}
              disabled={loading || ontology.length === 0}
              className="h-12 flex-1 rounded-2xl gradient-rose text-primary-foreground shadow-[var(--shadow-soft)]"
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Build Graph
            </Button>
          </div>
        </div>
      )}

      {step === 3 && sim && (
        <div className="space-y-3">
          <div className="glass rounded-[24px] p-3">
            <ForceGraph nodes={sim.graph.nodes} edges={sim.graph.edges} />
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep(2)} className="rounded-2xl">
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <Button
              onClick={continueToAgents}
              className="h-12 flex-1 rounded-2xl gradient-rose text-primary-foreground shadow-[var(--shadow-soft)]"
            >
              Continue to Agents <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </PageShell>
  );
}

function Steps({ step, onJump }: { step: number; onJump: (s: 1 | 2 | 3) => void }) {
  return (
    <div className="mb-2 flex items-center justify-center gap-2">
      {[1, 2, 3].map((n) => (
        <button
          key={n}
          onClick={() => onJump(n as 1 | 2 | 3)}
          className={`h-2 rounded-full transition-all ${step === n ? "w-8 bg-primary" : "w-2 bg-muted-foreground/30"}`}
          aria-label={`Step ${n}`}
        />
      ))}
    </div>
  );
}

function OntologyCard({
  node, onChange, onDelete,
}: { node: OntologyNode; onChange: (n: OntologyNode) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="glass rounded-[22px] p-4">
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <input
            value={node.label}
            onChange={(e) => onChange({ ...node, label: e.target.value })}
            className="flex-1 rounded-xl bg-white/70 px-3 py-1.5 font-medium outline-none ring-1 ring-border focus:ring-primary/40"
          />
        ) : (
          <div className="font-medium">{node.label}</div>
        )}
        <div className="flex gap-1">
          <button onClick={() => setEditing((v) => !v)} className="rounded-full p-1.5 text-muted-foreground hover:bg-white/60">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={onDelete} className="rounded-full p-1.5 text-muted-foreground hover:bg-white/60">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="mt-1 inline-block rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-secondary-foreground">
        {node.type}
      </div>
      {editing ? (
        <textarea
          value={node.description}
          onChange={(e) => onChange({ ...node, description: e.target.value })}
          className="mt-2 w-full rounded-xl bg-white/70 px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary/40"
          rows={2}
        />
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{node.description}</p>
      )}
    </div>
  );
}

function ForceGraph({ nodes, edges }: { nodes: { id: string; label: string; group: number }[]; edges: { source: string; target: string; weight: number }[] }) {
  const ref = useRef<SVGSVGElement>(null);
  const positions = useMemo(() => {
    const W = 340, H = 320, cx = W / 2, cy = H / 2;
    const r = 130;
    return Object.fromEntries(
      nodes.map((n, i) => {
        const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
        return [n.id, { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }];
      })
    );
  }, [nodes]);
  const palette = ["#D4A5A5", "#E8D5B5", "#8EC0B5", "#C9A8D4", "#B5C9D4"];
  return (
    <svg ref={ref} viewBox="0 0 340 320" className="h-[320px] w-full">
      {edges.map((e, i) => {
        const a = positions[e.source], b = positions[e.target];
        if (!a || !b) return null;
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(180,140,120,0.25)" strokeWidth={Math.max(1, e.weight)} />;
      })}
      {nodes.map((n) => {
        const p = positions[n.id]; if (!p) return null;
        const c = palette[n.group % palette.length];
        return (
          <g key={n.id}>
            <circle cx={p.x} cy={p.y} r={18} fill={c} opacity={0.85} />
            <circle cx={p.x} cy={p.y} r={18} fill="none" stroke="white" strokeWidth={2} />
            <text x={p.x} y={p.y + 32} textAnchor="middle" fontSize={10} fill="#5a4a44" fontFamily="Inter">
              {n.label.length > 18 ? n.label.slice(0, 16) + "…" : n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function V8Toggles({ sim, setSim }: { sim: Simulation; setSim: (s: Simulation) => void }) {
  const flags = sim.v8Flags ?? {};
  const set = (patch: Partial<NonNullable<Simulation["v8Flags"]>>) => {
    const next: Simulation = { ...sim, v8Flags: { ...flags, ...patch } };
    setSim(next); saveSimulation(next);
  };
  type ToggleKey = "iterativeSettling" | "probabilityCloud" | "hardDissonance" | "beliefModeling" | "oasis" | "gameTheory";
  const items: { key: ToggleKey; label: string; hint: string; warn?: string }[] = [
    { key: "iterativeSettling", label: "Iterative Settling", hint: "Up to 3 internal passes when contradiction × event > thresholds." },
    { key: "probabilityCloud", label: "Probability Cloud", hint: "30–50 noisy replays for outcome distributions." },
    { key: "hardDissonance", label: "Hard Active Dissonance", hint: "One-time self_worth jump after 3 rounds of cs>0.8.", warn: "⚠ HIGH RISK" },
    { key: "beliefModeling", label: "Cross-Agent Belief", hint: "Each agent models how peers see it (EMA)." },
    { key: "oasis", label: "OASIS Backend", hint: "Replace world layer with external endpoint when reachable.", warn: "⚠ REQUIRES BACKEND" },
    { key: "gameTheory", label: "Game-Theoretic Analysis", hint: "Post-sim Nash / Pareto / dominance via AI Gateway." },
  ];
  return (
    <div className="rounded-2xl bg-white/40 p-2 space-y-1.5">
      <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-primary">v8 Adaptive Cognition · Experimental</div>
      {items.map((it) => (
        <div key={it.key} className="flex items-center justify-between gap-2 rounded-xl bg-white/60 px-2.5 py-1.5">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold flex items-center gap-1.5">
              {it.label}
              {it.warn && <span className="rounded-full bg-[oklch(0.92_0.06_25)] px-1.5 py-0.5 text-[8px] font-bold text-primary">{it.warn}</span>}
            </div>
            <div className="text-[10px] leading-snug text-muted-foreground">{it.hint}</div>
          </div>
          <Switch checked={!!flags[it.key]} onCheckedChange={(v) => set({ [it.key]: v })} />
        </div>
      ))}
      {flags.oasis && (
        <input
          type="url"
          value={flags.oasisEndpoint ?? ""}
          placeholder="https://oasis.example.com"
          onChange={(e) => set({ oasisEndpoint: e.target.value })}
          className="w-full rounded-xl bg-white/70 px-2.5 py-1 text-[11px] font-mono outline-none ring-1 ring-border focus:ring-primary/40"
        />
      )}
    </div>
  );
}
