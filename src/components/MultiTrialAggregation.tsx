// MultiTrialAggregation — runs 30 trials of the deterministic kernel with
// different seeds, aggregates outcome vector statistics, clusters by outcome
// similarity (K-means K=3), and renders Platt-scaled probability estimates.
//
// All state is component-local. No persistence.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip, Legend,
} from "recharts";
import { useNyxKernel, type Scenario, type OutcomeVector } from "@/hooks/useNyxKernel";

const TRIALS = 30;
const ROUNDS = 4;
const COMPONENTS = ["reputation_mean", "inequality", "trust_proxy", "centralization"] as const;
type Component = typeof COMPONENTS[number];

interface TrialOutcome {
  seed: number;
  vector: Record<Component, number>;
}

interface ClusterAssignment {
  index: number;
  cluster: 0 | 1 | 2;
}

interface ClusterSummary {
  id: 0 | 1 | 2;
  label: string;
  count: number;
  centroid: Record<Component, number>;
  topVars: { variable: Component; deviation: number }[];
}

function mean(xs: number[]) { return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length); }
function stddev(xs: number[]) {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length));
}
function percentile(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.max(0, Math.min(s.length - 1, Math.floor(p * (s.length - 1))));
  return s[i];
}
function dist(a: Record<Component, number>, b: Record<Component, number>) {
  let s = 0;
  for (const k of COMPONENTS) s += (a[k] - b[k]) ** 2;
  return Math.sqrt(s);
}

function kmeans(points: Record<Component, number>[], K = 3, iters = 20) {
  if (points.length < K) return points.map((_, i) => i % K);
  // init: spread by index
  let centroids = Array.from({ length: K }, (_, k) =>
    ({ ...points[Math.floor((k * points.length) / K)] })
  );
  let assignments = new Array(points.length).fill(0);
  for (let it = 0; it < iters; it++) {
    assignments = points.map((p) => {
      let best = 0; let bestD = Infinity;
      centroids.forEach((c, k) => { const d = dist(p, c); if (d < bestD) { bestD = d; best = k; } });
      return best;
    });
    centroids = centroids.map((_, k) => {
      const members = points.filter((_, i) => assignments[i] === k);
      if (!members.length) return centroids[k];
      const out = {} as Record<Component, number>;
      for (const c of COMPONENTS) out[c] = mean(members.map((m) => m[c]));
      return out;
    });
  }
  return assignments;
}

function labelCluster(centroid: Record<Component, number>): string {
  // Critical-fix sprint #4: tighter, mutually exclusive thresholds so the
  // dominant label cannot drift into "Stable Convergence" while clusters
  // actually show stalemate.
  if (centroid.trust_proxy >= 0.6 && centroid.inequality < 0.35) return "Stable Convergence";
  if (centroid.trust_proxy < 0.35 && centroid.inequality > 0.5) return "Fragmented Failure";
  if (centroid.inequality > 0.35 || centroid.trust_proxy < 0.55) return "Polarized Stalemate";
  return "Polarized Stalemate";
}

// Cluster-derived narrative summary. Reads strictly from cluster names and
// statistics — never injects optimistic language.
function buildClusterNarrative(clusters: ClusterSummary[]): string {
  const total = clusters.reduce((a, c) => a + c.count, 0) || 1;
  const sorted = [...clusters].sort((a, b) => b.count - a.count);
  const top = sorted[0];
  const topShare = top.count / total;
  const baseLabel = top.label.replace(/ \(\d+\)$/, "");
  let head = "";
  switch (baseLabel) {
    case "Stable Convergence":
      head = `Trajectories converge: ${Math.round(topShare * 100)}% of trials land in stable convergence.`;
      break;
    case "Polarized Stalemate":
      head = `Entrenched polarization: ${Math.round(topShare * 100)}% of trials end in deep stalemate with no shared resolution.`;
      break;
    case "Fragmented Failure":
      head = `Fragmented failure dominates: ${Math.round(topShare * 100)}% of trials show collapse of trust and widening divisions.`;
      break;
    default:
      head = `Dominant pattern: ${baseLabel} (${Math.round(topShare * 100)}%).`;
  }
  if (topShare < 0.7) {
    head += " No single dominant outcome pattern — high uncertainty.";
  }
  return head;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
// Platt scaling (session defaults — not historically calibrated)
const PLATT_A = 4;
const PLATT_B = -2;

function plattProbabilities(clusters: ClusterSummary[]): { success: number; backlash: number; collapse: number } {
  const total = clusters.reduce((a, c) => a + c.count, 0) || 1;
  const sFrac = (clusters.find((c) => c.label === "Stable Convergence")?.count ?? 0) / total;
  const pFrac = (clusters.find((c) => c.label === "Polarized Stalemate")?.count ?? 0) / total;
  const fFrac = (clusters.find((c) => c.label === "Fragmented Failure")?.count ?? 0) / total;
  const success = sigmoid(PLATT_A * sFrac + PLATT_B);
  const backlash = sigmoid(PLATT_A * pFrac + PLATT_B);
  const collapse = sigmoid(PLATT_A * fFrac + PLATT_B);
  // normalise to sum to ~100 visually (display only; Platt outputs are independent)
  const sum = success + backlash + collapse;
  return {
    success: success / sum,
    backlash: backlash / sum,
    collapse: collapse / sum,
  };
}

const PIE_COLORS: Record<string, string> = {
  "Stable Convergence": "oklch(0.7 0.12 180)",
  "Polarized Stalemate": "oklch(0.7 0.13 55)",
  "Fragmented Failure": "oklch(0.6 0.18 25)",
};

interface Props {
  buildScenario: () => Scenario | null;
}

export function MultiTrialAggregation({ buildScenario }: Props) {
  const kernel = useNyxKernel();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [trials, setTrials] = useState<TrialOutcome[] | null>(null);
  const [clusters, setClusters] = useState<ClusterSummary[] | null>(null);

  async function runTrials() {
    const scenario = buildScenario();
    if (!scenario) return;
    if (!kernel.ready) return;
    setRunning(true);
    setTrials(null);
    setClusters(null);
    setProgress(0);
    try {
      const out: TrialOutcome[] = [];
      for (let i = 0; i < TRIALS; i++) {
        const seed = i + 1;
        try {
          const r = await kernel.runSimulation(scenario, ROUNDS, seed);
          const v = r.outcomeVector as OutcomeVector;
          out.push({
            seed,
            vector: {
              reputation_mean: v.reputation_mean ?? 0,
              inequality: v.inequality ?? 0,
              trust_proxy: v.trust_proxy ?? 0,
              centralization: v.centralization ?? 0,
            },
          });
        } catch (e) {
          console.warn("[MultiTrial] trial failed", seed, e);
        }
        setProgress(i + 1);
        await new Promise((r) => setTimeout(r, 0));
      }
      setTrials(out);
      // Cluster
      const points = out.map((o) => o.vector);
      const assignments = kmeans(points, 3, 25);
      const summaries: ClusterSummary[] = [0, 1, 2].map((k) => {
        const members = points.filter((_, i) => assignments[i] === k);
        const centroid = {} as Record<Component, number>;
        for (const c of COMPONENTS) centroid[c] = mean(members.map((m) => m[c] ?? 0));
        return { id: k as 0 | 1 | 2, label: labelCluster(centroid), count: members.length, centroid, topVars: [] };
      });
      // dedupe label collisions
      const seen = new Set<string>();
      for (const s of summaries) {
        let lbl = s.label; let i = 2;
        while (seen.has(lbl)) lbl = `${s.label} (${i++})`;
        s.label = lbl; seen.add(lbl);
      }
      // top distinguishing variables = abs(centroid - global mean)
      const globalMean = {} as Record<Component, number>;
      for (const c of COMPONENTS) globalMean[c] = mean(points.map((p) => p[c]));
      for (const s of summaries) {
        s.topVars = COMPONENTS
          .map((v) => ({ variable: v, deviation: +Math.abs(s.centroid[v] - globalMean[v]).toFixed(3) }))
          .sort((a, b) => b.deviation - a.deviation)
          .slice(0, 3);
      }
      setClusters(summaries);
    } finally {
      setRunning(false);
    }
  }

  const probs = clusters ? plattProbabilities(clusters) : null;

  return (
    <div className="glass rounded-[22px]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
      >
        <span className="flex flex-col items-start">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
            Multi-Trial Aggregation · BLF
          </span>
          <span className="text-xs text-muted-foreground">
            30 seeds · clustering · calibrated probability
          </span>
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4">
          <label className="flex items-center justify-between gap-2 rounded-2xl bg-white/70 px-3 py-2 text-xs">
            <span>
              <span className="font-semibold">Multi-Trial Mode</span>
              <span className="ml-1 text-muted-foreground text-[10px]">(requires deterministic kernel)</span>
            </span>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          </label>
          {enabled && (
            <>
              {!kernel.ready && (
                <div className="rounded-xl bg-[oklch(0.93_0.06_25)] px-2 py-1.5 text-[10px] text-primary">
                  Deterministic kernel not ready — wait for it to load.
                </div>
              )}
              <Button size="sm" disabled={running || !kernel.ready} onClick={runTrials} className="w-full">
                {running
                  ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> {progress}/{TRIALS}…</>
                  : "Run 30 Trials"}
              </Button>
              {trials && trials.length > 0 && (
                <div className="rounded-2xl bg-white/70 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Outcome Statistics ({trials.length} trials)
                  </div>
                  <table className="mt-1 w-full text-[10px]">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="py-1">Component</th><th>Mean</th><th>StdDev</th><th>90% CI</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono tabular-nums">
                      {COMPONENTS.map((c) => {
                        const xs = trials.map((t) => t.vector[c]);
                        const lo = percentile(xs, 0.05);
                        const hi = percentile(xs, 0.95);
                        return (
                          <tr key={c} className="border-t border-secondary/30">
                            <td className="py-0.5 font-sans">{c}</td>
                            <td>{mean(xs).toFixed(3)}</td>
                            <td>{stddev(xs).toFixed(3)}</td>
                            <td>[{lo.toFixed(2)}, {hi.toFixed(2)}]</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {clusters && (
                <div className="rounded-2xl bg-white/70 p-3 space-y-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Trajectory Clusters (K=3)
                  </div>
                  <div className="rounded-xl bg-[oklch(0.96_0.02_60)] px-2.5 py-1.5 text-[11px] leading-snug text-[oklch(0.32_0.04_60)]">
                    {buildClusterNarrative(clusters)}
                  </div>
                  <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={clusters.map((c) => ({ name: c.label, value: c.count }))}
                          dataKey="value"
                          nameKey="name"
                          outerRadius={60}
                          label={(e) => `${e.value}`}
                        >
                          {clusters.map((c, i) => (
                            <Cell key={i} fill={PIE_COLORS[c.label.replace(/ \(\d+\)$/, "")] ?? "oklch(0.7 0.05 0)"} />
                          ))}
                        </Pie>
                        <Legend wrapperStyle={{ fontSize: 9 }} />
                        <RTooltip contentStyle={{ fontSize: 10, borderRadius: 8 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-1">
                    {clusters.map((c) => (
                      <div key={c.id} className="rounded-xl bg-secondary/40 px-2 py-1.5 text-[10px]">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">{c.label}</span>
                          <span className="font-mono text-muted-foreground">n={c.count}</span>
                        </div>
                        <div className="mt-0.5 text-muted-foreground">
                          Top distinguishing: {c.topVars.map((v) => `${v.variable} (Δ${v.deviation})`).join(" · ")}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {probs && (
                <div className="rounded-2xl bg-white/70 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Calibrated Probabilities (Platt)
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-[oklch(0.93_0.06_25)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                      <AlertTriangle className="h-2.5 w-2.5" /> Not historically calibrated
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <ProbCell label="Policy Success" value={probs.success} tone="ok" />
                    <ProbCell label="Backlash / Polarization" value={probs.backlash} tone="warn" />
                    <ProbCell label="Implementation Collapse" value={probs.collapse} tone="risk" />
                  </div>
                  <p className="text-[9px] leading-snug text-muted-foreground">
                    Probabilities derive from simulation-internal cluster distributions, not real-world validation.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ProbCell({ label, value, tone }: { label: string; value: number; tone: "ok" | "warn" | "risk" }) {
  const cls =
    tone === "ok" ? "bg-[oklch(0.9_0.06_180)] text-[oklch(0.4_0.06_180)]" :
    tone === "warn" ? "bg-[oklch(0.92_0.07_55)] text-primary" :
    "bg-[oklch(0.93_0.06_25)] text-primary";
  return (
    <div className={cn("rounded-xl px-2 py-1.5", cls)}>
      <div className="text-[9px] font-semibold uppercase tracking-wider">{label}</div>
      <div className="font-mono text-sm tabular-nums">{Math.round(value * 100)}%</div>
    </div>
  );
}
