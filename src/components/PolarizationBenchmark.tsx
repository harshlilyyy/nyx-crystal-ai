// Polarization Benchmark — calibration against the Prophet (Sci. Reports 2025)
// finding that homophilic clustering and human-like polarization patterns
// emerge spontaneously from LLM-guided multi-agent interaction.
//
// Pure UI + ephemeral computation. No persistent state. Gated behind the
// Advanced Simulation toggle by the parent page.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { initRuntime, applyV5Round } from "@/lib/nyx-causal";
import { NYX_AGENTS } from "@/lib/nyx-agents";

type ScenarioKey = "balanced" | "skewed" | "polarized";

interface RoundPoint {
  round: number;
  polarization: number;
  convergence: number;
}

interface ScenarioResult {
  key: ScenarioKey;
  label: string;
  expected: string;
  series: RoundPoint[]; // averaged across seeds
}

const ROUNDS = 8;
const SEEDS = 10;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stddev(xs: number[]): number {
  if (!xs.length) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

// Build initial self_worth distribution per scenario.
function distributeSelfWorth(scenario: ScenarioKey, n: number, rng: () => number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let v: number;
    if (scenario === "balanced") {
      v = 0.5 + (rng() - 0.5) * 0.1;
    } else if (scenario === "skewed") {
      // most agents low, a few high
      v = i < n * 0.75 ? 0.2 + rng() * 0.15 : 0.7 + rng() * 0.2;
    } else {
      // polarized: bimodal at the extremes
      v = i % 2 === 0 ? 0.15 + rng() * 0.1 : 0.8 + rng() * 0.1;
    }
    out.push(Math.max(0, Math.min(1, v)));
  }
  return out;
}

async function runScenario(scenario: ScenarioKey): Promise<RoundPoint[]> {
  const ids = NYX_AGENTS.map((a) => a.id).slice(0, 8);
  const accumPolar: number[] = Array(ROUNDS).fill(0);
  for (let s = 0; s < SEEDS; s++) {
    const rng = mulberry(1000 * (scenario.length) + s + 1);
    const runtime = initRuntime(ids);
    const init = distributeSelfWorth(scenario, ids.length, rng);
    let i = 0;
    for (const id of ids) {
      const rt = runtime[id];
      if (rt.core) rt.core.self_worth = init[i];
      i++;
    }
    for (let r = 0; r < ROUNDS; r++) {
      try {
        applyV5Round(runtime, r, ROUNDS);
      } catch {
        /* skip */
      }
      const sw = Object.values(runtime)
        .map((rt) => rt.core?.self_worth ?? 0.5)
        .filter((v) => Number.isFinite(v));
      accumPolar[r] += stddev(sw);
    }
    if (s % 3 === 0) await new Promise((res) => setTimeout(res, 0));
  }
  return accumPolar.map((sum, r) => {
    const polar = sum / SEEDS;
    return {
      round: r + 1,
      polarization: +polar.toFixed(4),
      convergence: +Math.max(0, 1 - polar).toFixed(4),
    };
  });
}

export function PolarizationBenchmark() {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ScenarioResult[] | null>(null);

  async function run() {
    setRunning(true);
    try {
      const defs: { key: ScenarioKey; label: string; expected: string }[] = [
        {
          key: "balanced",
          label: "Balanced initial distribution",
          expected:
            "Prophet baseline: low residual polarization with slow drift; convergence stays high.",
        },
        {
          key: "skewed",
          label: "Skewed (minority elite)",
          expected:
            "Echo-chamber pull: polarization rises as the minority cluster reinforces itself.",
        },
        {
          key: "polarized",
          label: "Pre-polarized (bimodal)",
          expected:
            "Homophilic clustering persists; convergence remains low across rounds.",
        },
      ];
      const out: ScenarioResult[] = [];
      for (const d of defs) {
        const series = await runScenario(d.key);
        out.push({ ...d, series });
      }
      setResults(out);
    } finally {
      setRunning(false);
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
            Polarization Benchmark · Prophet 2025
          </span>
          <span className="text-xs text-muted-foreground">
            Calibrate Nyx against a published multi-agent polarization study
          </span>
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] leading-snug text-muted-foreground">
              Runs three controlled scenarios (balanced / skewed / polarized initial
              self_worth) across {SEEDS} seeds × {ROUNDS} rounds. Compares the resulting
              polarization &amp; convergence trajectories against the qualitative pattern
              from <em>Scientific Reports</em> (Prophet, 2025).
            </p>
            <Button onClick={run} disabled={running} size="sm">
              {running ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Running…
                </>
              ) : (
                "Run Benchmark"
              )}
            </Button>
          </div>
          {results && (
            <div className="space-y-3">
              {results.map((r) => (
                <div key={r.key} className="rounded-2xl bg-white/70 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-semibold">{r.label}</div>
                    <div className="text-[9px] font-mono text-muted-foreground">
                      pol→{r.series[r.series.length - 1].polarization.toFixed(3)} · conv→
                      {r.series[r.series.length - 1].convergence.toFixed(3)}
                    </div>
                  </div>
                  <div className="mt-1 h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={r.series} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                        <XAxis
                          dataKey="round"
                          tick={{ fontSize: 9 }}
                          stroke="oklch(0.6 0 0)"
                        />
                        <YAxis
                          domain={[0, 1]}
                          tick={{ fontSize: 9 }}
                          stroke="oklch(0.6 0 0)"
                        />
                        <RTooltip
                          contentStyle={{
                            fontSize: 10,
                            borderRadius: 8,
                            border: "1px solid oklch(0.9 0 0)",
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: 9 }} />
                        <Line
                          type="monotone"
                          dataKey="polarization"
                          stroke="oklch(0.6 0.18 25)"
                          dot={false}
                          strokeWidth={1.5}
                        />
                        <Line
                          type="monotone"
                          dataKey="convergence"
                          stroke="oklch(0.55 0.12 180)"
                          dot={false}
                          strokeWidth={1.5}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div
                    className={cn(
                      "mt-1 rounded-xl bg-secondary/40 px-2 py-1 text-[10px] leading-snug text-muted-foreground"
                    )}
                  >
                    <span className="font-semibold">Expected pattern:</span> {r.expected}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
