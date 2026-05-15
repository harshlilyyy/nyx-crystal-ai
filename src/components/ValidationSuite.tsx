// ValidationSuite — Reproducibility check + Ablation study.
// Polarization Benchmark lives in its own component (PolarizationBenchmark).
// Pure UI + ephemeral computation. Gated behind Advanced Simulation by parent.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  initRuntime,
  applyV5Round,
  setSimulationSeed,
  successScore,
} from "@/lib/nyx-causal";
import { NYX_AGENTS } from "@/lib/nyx-agents";
import type { CoreVar } from "@/lib/nyx-types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip as RTooltip,
  LabelList,
} from "recharts";

const ROUNDS = 4;
const ABLATION_VALUE = 0.5;

const CORE_VARS: CoreVar[] = [
  "self_worth",
  "anxiety",
  "consistency",
  "momentum",
  "reputation",
  "opportunity_access",
  "fragility_index",
  "lock_in",
  "learning_rate",
  "energy",
];

interface ReproResult {
  ok: boolean;
  maxDeviation: number;
  variable?: string;
  agent?: string;
}

interface AblationRow {
  variable: CoreVar;
  deltaSDamped: number;
}

function snapshotCore(runtime: Record<string, ReturnType<typeof initRuntime>[string]>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [id, rt] of Object.entries(runtime)) {
    if (!rt.core) continue;
    out[id] = { ...rt.core } as Record<string, number>;
  }
  return out;
}

function runOnce(seed: number, agentIds: string[], lockedVar?: CoreVar) {
  setSimulationSeed(seed);
  const runtime = initRuntime(agentIds);
  for (let r = 0; r < ROUNDS; r++) {
    if (lockedVar) {
      for (const rt of Object.values(runtime)) {
        if (rt.core) rt.core[lockedVar] = ABLATION_VALUE;
      }
    }
    setSimulationSeed((seed + r * 0x9e3779b1) | 0);
    try { applyV5Round(runtime, r, ROUNDS); } catch { /* ignore */ }
    if (lockedVar) {
      for (const rt of Object.values(runtime)) {
        if (rt.core) rt.core[lockedVar] = ABLATION_VALUE;
      }
    }
  }
  return runtime;
}

function meanSuccess(runtime: ReturnType<typeof runOnce>): number {
  const xs = Object.values(runtime).map((rt) => successScore(rt));
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function ValidationSuite() {
  const [open, setOpen] = useState(false);
  const [reproRunning, setReproRunning] = useState(false);
  const [reproResult, setReproResult] = useState<ReproResult | null>(null);
  const [ablRunning, setAblRunning] = useState(false);
  const [ablResult, setAblResult] = useState<AblationRow[] | null>(null);

  async function runReproducibility() {
    setReproRunning(true);
    setReproResult(null);
    await new Promise((r) => setTimeout(r, 0));
    try {
      const ids = NYX_AGENTS.map((a) => a.id).slice(0, 8);
      const seed = 1337;
      const runs = [runOnce(seed, ids), runOnce(seed, ids), runOnce(seed, ids)].map(snapshotCore);
      let maxDev = 0;
      let badVar: string | undefined;
      let badAgent: string | undefined;
      for (const id of ids) {
        const a = runs[0][id]; const b = runs[1][id]; const c = runs[2][id];
        if (!a || !b || !c) continue;
        for (const k of CORE_VARS) {
          const d1 = Math.abs(a[k] - b[k]);
          const d2 = Math.abs(b[k] - c[k]);
          const d = Math.max(d1, d2);
          if (d > maxDev) { maxDev = d; badVar = k; badAgent = id; }
        }
      }
      const ok = maxDev < 0.0005; // < 3-decimal tolerance
      setReproResult({ ok, maxDeviation: maxDev, variable: badVar, agent: badAgent });
    } finally {
      setReproRunning(false);
    }
  }

  async function runAblation() {
    setAblRunning(true);
    setAblResult(null);
    await new Promise((r) => setTimeout(r, 0));
    try {
      const ids = NYX_AGENTS.map((a) => a.id).slice(0, 8);
      const seed = 4242;
      const baseline = meanSuccess(runOnce(seed, ids));
      const rows: AblationRow[] = [];
      for (const v of CORE_VARS) {
        const ablated = meanSuccess(runOnce(seed, ids, v));
        rows.push({ variable: v, deltaSDamped: +Math.abs(baseline - ablated).toFixed(4) });
        await new Promise((r) => setTimeout(r, 0));
      }
      rows.sort((a, b) => b.deltaSDamped - a.deltaSDamped);
      setAblResult(rows);
    } finally {
      setAblRunning(false);
    }
  }

  return (
    <div className="glass rounded-[22px]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
      >
        <span className="flex flex-col items-start">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
            Validation Suite
          </span>
          <span className="text-xs text-muted-foreground">
            Reproducibility · Ablation · Variable importance
          </span>
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4">
          {/* Reproducibility */}
          <div className="rounded-2xl bg-white/70 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col">
                <div className="text-[11px] font-semibold">Seeded Reproducibility</div>
                <div className="text-[10px] leading-snug text-muted-foreground">
                  Runs the same seed 3× and verifies all 10 core variables match to 3 decimals.
                </div>
              </div>
              <Button size="sm" disabled={reproRunning} onClick={runReproducibility}>
                {reproRunning ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Running…</> : "Run Check"}
              </Button>
            </div>
            {reproResult && (
              <div className="mt-2 flex items-center gap-2">
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  reproResult.ok ? "bg-[oklch(0.9_0.06_180)] text-[oklch(0.4_0.06_180)]" : "bg-[oklch(0.93_0.06_25)] text-primary"
                )}>
                  {reproResult.ok ? "✅ Reproducible" : "❌ Divergent"}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  max Δ = {reproResult.maxDeviation.toExponential(2)}
                  {reproResult.variable && ` · ${reproResult.variable}`}
                </span>
              </div>
            )}
          </div>

          {/* Ablation */}
          <div className="rounded-2xl bg-white/70 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col">
                <div className="text-[11px] font-semibold">Ablation Test</div>
                <div className="text-[10px] leading-snug text-muted-foreground">
                  Locks each variable at 0.5 and measures impact on mean success score.
                </div>
              </div>
              <Button size="sm" disabled={ablRunning} onClick={runAblation}>
                {ablRunning ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Running…</> : "Run Ablation"}
              </Button>
            </div>
            {ablResult && (
              <div className="mt-2 h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ablResult} layout="vertical" margin={{ top: 4, right: 28, bottom: 0, left: 8 }}>
                    <XAxis type="number" tick={{ fontSize: 9 }} stroke="oklch(0.6 0 0)" />
                    <YAxis type="category" dataKey="variable" width={110} tick={{ fontSize: 9 }} stroke="oklch(0.6 0 0)" />
                    <RTooltip contentStyle={{ fontSize: 10, borderRadius: 8 }} />
                    <Bar dataKey="deltaSDamped" fill="oklch(0.6 0.18 25)">
                      <LabelList dataKey="deltaSDamped" position="right" style={{ fontSize: 9 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
