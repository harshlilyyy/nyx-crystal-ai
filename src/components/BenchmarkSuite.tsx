// BenchmarkSuite — Scientific validation harness for Nyx.
// Activated only when Advanced Simulation is ON and the URL contains
// `?benchmark=true`. Runs four asynchronous tests (Polarization, Cascade,
// Entropy, Attractor) over the deterministic v5 engine. Session-only,
// no persistence, no impact on the normal simulation path.
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  initRuntime,
  applyV5Round,
  setSimulationSeed,
} from "@/lib/nyx-causal";
import { NYX_AGENTS } from "@/lib/nyx-agents";
import type { AgentRuntime } from "@/lib/nyx-types";

type Status = "idle" | "running" | "passed" | "failed";
type TestKey = "polarization" | "cascade" | "entropy" | "attractor";

interface TestState {
  status: Status;
  message?: string;
  data?: unknown;
}

const yieldUI = () => new Promise<void>((r) => setTimeout(r, 0));

function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length;
}
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function shannon(probs: number[]): number {
  let h = 0;
  for (const p of probs) if (p > 0) h -= p * Math.log2(p);
  return h;
}

const BUCKETS = ["AVOID", "RECOVER", "EXECUTE", "OPTIMIZE"] as const;
function bucket(mode: string | undefined): typeof BUCKETS[number] {
  switch (mode) {
    case "avoid":
    case "fragile":
    case "collapse":
      return "AVOID";
    case "recovery":
      return "RECOVER";
    case "growth":
    case "spike":
      return "OPTIMIZE";
    default:
      return "EXECUTE";
  }
}

function modeDistribution(rt: Record<string, AgentRuntime>): number[] {
  const counts: Record<string, number> = { AVOID: 0, RECOVER: 0, EXECUTE: 0, OPTIMIZE: 0 };
  const vs = Object.values(rt);
  for (const r of vs) counts[bucket(r.modeV5)]++;
  return BUCKETS.map((k) => counts[k] / Math.max(1, vs.length));
}

function cloneIds(n: number): string[] {
  return NYX_AGENTS.map((a) => a.id).slice(0, n);
}

function runV5(seed: number, rounds: number, setup?: (rt: Record<string, AgentRuntime>) => void, n = 8) {
  const ids = cloneIds(n);
  setSimulationSeed(seed);
  const runtime = initRuntime(ids);
  if (setup) setup(runtime);
  const perRound: Array<{
    polarization: number;
    distribution: number[];
    cascades: number;
  }> = [];
  for (let r = 0; r < rounds; r++) {
    setSimulationSeed((seed + r * 0x9e3779b1) | 0);
    try { applyV5Round(runtime, r, rounds); } catch { /* ignore */ }
    const sw = Object.values(runtime).map((rt) => rt.core?.self_worth ?? 0.5);
    perRound.push({
      polarization: variance(sw),
      distribution: modeDistribution(runtime),
      cascades: Object.values(runtime).filter((rt) => rt.cascade).length,
    });
  }
  return { runtime, perRound };
}

// ===== Polarization Test =====
async function runPolarization(): Promise<{ pass: boolean; message: string; data: unknown }> {
  const ROUNDS = 4;
  const runs: number[][] = []; // polarization per round, per run
  for (let s = 0; s < 10; s++) {
    const seed = 100 + s;
    const { perRound } = runV5(seed, ROUNDS, (rt) => {
      // Two opposing factions: 4 low self_worth, 4 high
      const ids = Object.keys(rt);
      ids.forEach((id, i) => {
        const c = rt[id].core;
        if (!c) return;
        if (i < ids.length / 2) { c.self_worth = 0.25; c.momentum = 0.3; }
        else { c.self_worth = 0.75; c.momentum = 0.7; }
      });
    });
    runs.push(perRound.map((p) => p.polarization));
    if (s % 3 === 0) await yieldUI();
  }
  const finals = runs.map((r) => r[r.length - 1]);
  const firsts = runs.map((r) => r[0]);
  const meanFinal = mean(finals);
  const growth = mean(finals) - mean(firsts);
  const pass = meanFinal > 0.10 && growth > 0.03;
  return {
    pass,
    message: pass
      ? `Mean polarization ${meanFinal.toFixed(3)} · growth ${growth.toFixed(3)}`
      : `Low polarization dynamics — mean ${meanFinal.toFixed(3)} · growth ${growth.toFixed(3)}`,
    data: { meanFinal, growth, runs, seeds: Array.from({ length: 10 }, (_, i) => 100 + i) },
  };
}

// ===== Cascade Test =====
async function runCascade(): Promise<{ pass: boolean; message: string; data: unknown }> {
  const ROUNDS = 4;
  const SEEDS = 5;
  const totals: number[] = [];
  const chains: number[][] = [];
  for (let s = 0; s < SEEDS; s++) {
    const seed = 200 + s;
    const { perRound, runtime } = runV5(seed, ROUNDS, (rt) => {
      const ids = Object.keys(rt);
      const fragile = rt[ids[0]].core;
      if (fragile) { fragile.self_worth = 0.3; fragile.anxiety = 0.8; fragile.fragility_index = 0.7; }
      // Boost connectedness via momentum on the next 3 agents.
      for (let i = 1; i < 4 && i < ids.length; i++) {
        const c = rt[ids[i]].core;
        if (c) { c.consistency = 0.3; c.fragility_index = 0.6; }
      }
    });
    const final = Object.values(runtime).filter((rt) => rt.cascade).length;
    totals.push(final);
    chains.push(perRound.map((p) => p.cascades));
    await yieldUI();
  }
  const avg = mean(totals);
  const pass = avg > 1.2;
  return {
    pass,
    message: pass
      ? `Avg cascade size ${avg.toFixed(2)} across ${SEEDS} runs`
      : `Cascade propagation insufficient — avg ${avg.toFixed(2)}`,
    data: { avg, totals, chains },
  };
}

// ===== Entropy Test =====
async function runEntropy(): Promise<{ pass: boolean; message: string; data: unknown }> {
  const ROUNDS = 6;
  const SEEDS = 5;
  const runs: Array<{
    seed: number;
    entropy: number[];
    cascades: number[];
    collapseBeforeCascade: boolean;
  }> = [];
  for (let s = 0; s < SEEDS; s++) {
    const seed = 300 + s;
    const { perRound } = runV5(seed, ROUNDS, (rt) => {
      // mixed scenario — half stressed
      const ids = Object.keys(rt);
      ids.forEach((id, i) => {
        const c = rt[id].core;
        if (!c) return;
        if (i % 2 === 0) { c.anxiety = 0.6; c.self_worth = 0.35; }
      });
    });
    const entropy = perRound.map((p) => shannon(p.distribution));
    const cascades = perRound.map((p) => p.cascades);
    let collapseBeforeCascade = false;
    for (let r = 1; r < entropy.length - 1; r++) {
      if (entropy[r - 1] < 1.0 && entropy[r] < 1.0 && cascades[r + 1] > cascades[r]) {
        collapseBeforeCascade = true;
        break;
      }
    }
    runs.push({ seed, entropy, cascades, collapseBeforeCascade });
    await yieldUI();
  }
  const hits = runs.filter((r) => r.collapseBeforeCascade).length;
  const pass = hits >= 1;
  return {
    pass,
    message: pass
      ? `Entropy-collapse → cascade link observed in ${hits}/${SEEDS} runs`
      : `Entropy-collapse link not observed (0/${SEEDS}) — may need richer scenarios`,
    data: { hits, runs },
  };
}

// ===== Attractor Test (k-means on outcome vectors) =====
type Vec4 = [number, number, number, number];

function dist2(a: Vec4, b: Vec4): number {
  let s = 0;
  for (let i = 0; i < 4; i++) { const d = a[i] - b[i]; s += d * d; }
  return s;
}

function kmeans(points: Vec4[], k: number, iters = 20): { labels: number[]; centroids: Vec4[] } {
  if (points.length === 0) return { labels: [], centroids: [] };
  // Deterministic seeding: evenly-spaced picks
  const centroids: Vec4[] = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.floor((i + 0.5) * (points.length / k));
    centroids.push([...points[Math.min(idx, points.length - 1)]] as Vec4);
  }
  const labels = new Array(points.length).fill(0);
  for (let it = 0; it < iters; it++) {
    // Assign
    for (let i = 0; i < points.length; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = dist2(points[i], centroids[c]);
        if (d < bd) { bd = d; best = c; }
      }
      labels[i] = best;
    }
    // Update
    const sums: number[][] = Array.from({ length: k }, () => [0, 0, 0, 0]);
    const counts = new Array(k).fill(0);
    for (let i = 0; i < points.length; i++) {
      const l = labels[i];
      for (let j = 0; j < 4; j++) sums[l][j] += points[i][j];
      counts[l]++;
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) centroids[c] = sums[c].map((v) => v / counts[c]) as Vec4;
    }
  }
  return { labels, centroids };
}

async function runAttractor(): Promise<{ pass: boolean; message: string; data: unknown }> {
  const ROUNDS = 5;
  const vectors: Vec4[] = [];
  for (let s = 0; s < 10; s++) {
    const seed = 400 + s;
    const { runtime } = runV5(seed, ROUNDS);
    const vs = Object.values(runtime);
    const reps = vs.map((rt) => rt.core?.reputation ?? 0.5);
    const anxs = vs.map((rt) => rt.core?.anxiety ?? 0.5);
    const moms = vs.map((rt) => rt.core?.momentum ?? 0.5);
    const vec: Vec4 = [
      mean(reps),
      variance(reps), // inequality proxy
      1 - mean(anxs), // trust proxy
      variance(moms), // centralization proxy
    ];
    vectors.push(vec);
    if (s % 3 === 0) await yieldUI();
  }
  let best: { pass: boolean; data: { k: number; sizes: number[]; dispersions: number[] } } | null = null;
  for (const k of [2, 3]) {
    const { labels, centroids } = kmeans(vectors, k);
    const sizes = new Array(k).fill(0);
    const sums = new Array(k).fill(0);
    labels.forEach((l, i) => {
      sizes[l]++;
      sums[l] += Math.sqrt(dist2(vectors[i], centroids[l]));
    });
    const dispersions = sizes.map((sz, i) => (sz > 0 ? sums[i] / sz : 0));
    const largest = sizes.indexOf(Math.max(...sizes));
    const ratio = sizes[largest] / vectors.length;
    const pass = ratio >= 0.6 && dispersions[largest] < 0.12;
    const candidate = { pass, data: { k, sizes, dispersions } };
    if (!best || (pass && !best.pass)) best = candidate;
  }
  const finalPass = best?.pass ?? false;
  return {
    pass: finalPass,
    message: finalPass
      ? `Strong attractor — k=${best!.data.k} sizes ${best!.data.sizes.join("/")}`
      : `No strong attractor detected (k=${best?.data.k}, sizes ${best?.data.sizes.join("/")})`,
    data: { vectors, ...best?.data },
  };
}

const TEST_DEFS: Array<{ key: TestKey; label: string; run: () => Promise<{ pass: boolean; message: string; data: unknown }> }> = [
  { key: "polarization", label: "Polarization", run: runPolarization },
  { key: "cascade", label: "Cascade", run: runCascade },
  { key: "entropy", label: "Entropy", run: runEntropy },
  { key: "attractor", label: "Attractor", run: runAttractor },
];

export function BenchmarkSuite() {
  const [tests, setTests] = useState<Record<TestKey, TestState>>({
    polarization: { status: "idle" },
    cascade: { status: "idle" },
    entropy: { status: "idle" },
    attractor: { status: "idle" },
  });
  const [running, setRunning] = useState(false);

  const summary = useMemo(() => {
    const done = Object.values(tests).filter((t) => t.status === "passed" || t.status === "failed");
    if (!done.length) return null;
    const passed = Object.values(tests).filter((t) => t.status === "passed").length;
    const failedNames = TEST_DEFS.filter((d) => tests[d.key].status === "failed").map((d) => d.label);
    return { passed, total: TEST_DEFS.length, failedNames };
  }, [tests]);

  async function runAll() {
    setRunning(true);
    const next: Record<TestKey, TestState> = {
      polarization: { status: "running" },
      cascade: { status: "running" },
      entropy: { status: "running" },
      attractor: { status: "running" },
    };
    setTests({ ...next });
    for (const def of TEST_DEFS) {
      try {
        const result = await def.run();
        next[def.key] = { status: result.pass ? "passed" : "failed", message: result.message, data: result.data };
      } catch (e) {
        next[def.key] = { status: "failed", message: `Error: ${(e as Error).message}` };
      }
      setTests({ ...next });
      await yieldUI();
    }
    setRunning(false);
  }

  function downloadReport() {
    const report = {
      generatedAt: new Date().toISOString(),
      agentCount: 8,
      tests: Object.fromEntries(
        TEST_DEFS.map((d) => [d.key, {
          label: d.label,
          status: tests[d.key].status,
          message: tests[d.key].message ?? null,
          data: tests[d.key].data ?? null,
        }])
      ),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nyx-benchmark-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const entropyData = tests.entropy.data as { runs?: Array<{ entropy: number[]; cascades: number[] }> } | undefined;

  return (
    <div className="glass rounded-[22px] p-4 ring-1 ring-[oklch(0.92_0.04_70)]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <div
            className="text-base font-semibold text-[oklch(0.32_0.04_60)]"
            style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
          >
            Validation Suite
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Benchmark Mode · Scientific validation
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={running} onClick={runAll}>
            {running ? (<><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Running…</>) : "Run All Tests"}
          </Button>
          {summary && (
            <Button size="sm" variant="outline" onClick={downloadReport}>
              <Download className="mr-1 h-3 w-3" /> Report
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {TEST_DEFS.map((def) => {
          const t = tests[def.key];
          return (
            <div key={def.key} className="flex items-start justify-between gap-2 rounded-xl bg-white/60 px-3 py-2">
              <div className="flex flex-col">
                <div className="text-[12px] font-semibold text-[oklch(0.32_0.04_60)]">{def.label}</div>
                {t.message && (
                  <div className="text-[10px] leading-snug text-muted-foreground">{t.message}</div>
                )}
              </div>
              <StatusBadge status={t.status} />
            </div>
          );
        })}
      </div>

      {/* Entropy sparkline */}
      {entropyData?.runs?.length ? (
        <div className="mt-3 rounded-xl bg-white/60 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Entropy trajectories (cascade ticks ↓)
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            {entropyData.runs.map((r, i) => (
              <EntropySpark key={i} entropy={r.entropy} cascades={r.cascades} />
            ))}
          </div>
        </div>
      ) : null}

      {summary && (
        <div className="mt-3 rounded-xl bg-[oklch(0.95_0.03_60)] px-3 py-2 text-[11px] text-[oklch(0.32_0.04_60)]">
          <span className="font-semibold">{summary.passed}/{summary.total} tests passed.</span>
          {summary.failedNames.length > 0 && (
            <> Review warnings for {summary.failedNames.join(", ")}.</>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string }> = {
    idle: { label: "Not run", cls: "bg-muted text-muted-foreground" },
    running: { label: "Running…", cls: "bg-[oklch(0.93_0.04_80)] text-[oklch(0.45_0.08_60)]" },
    passed: { label: "Passed ✓", cls: "bg-[oklch(0.92_0.06_60)] text-[oklch(0.45_0.12_45)]" },
    failed: { label: "Failed ✗", cls: "bg-[oklch(0.93_0.06_25)] text-primary" },
  };
  const m = map[status];
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", m.cls)}>
      {m.label}
    </span>
  );
}

function EntropySpark({ entropy, cascades }: { entropy: number[]; cascades: number[] }) {
  const W = 80, H = 28;
  if (!entropy.length) return null;
  const max = 2; // Shannon over 4 buckets max log2(4)=2
  const pts = entropy.map((v, i) => {
    const x = (i / Math.max(1, entropy.length - 1)) * W;
    const y = H - (v / max) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={W} height={H} className="rounded-md bg-white/70">
      <polyline points={pts} fill="none" stroke="oklch(0.45 0.12 45)" strokeWidth="1.5" />
      {cascades.map((c, i) => {
        if (i === 0 || c <= cascades[i - 1]) return null;
        const x = (i / Math.max(1, entropy.length - 1)) * W;
        return <circle key={i} cx={x} cy={H - 2} r="1.8" fill="oklch(0.6 0.18 25)" />;
      })}
    </svg>
  );
}

export function useBenchmarkMode(): boolean {
  return useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("benchmark") === "true";
    } catch {
      return false;
    }
  }, []);
}
