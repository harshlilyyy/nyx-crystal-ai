// ScenarioOutlookCard — Low-cost Monte Carlo (5 trials, deterministic, no LLM).
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { applyV5Round, setSimulationSeed } from "@/lib/nyx-causal";
import type { AgentRuntime, Simulation } from "@/lib/nyx-types";
import { meanReputation, trustProxy, polarizationScore } from "@/lib/nyx-complex";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip as RTooltip, ErrorBar } from "recharts";
import { toast } from "sonner";

interface OutcomeRow {
  metric: string;
  mean: number;
  low: number;
  high: number;
  err: number;
}

function inequalityOf(rt: Record<string, AgentRuntime>): number {
  const reps = Object.values(rt).map((r) => r.core?.reputation ?? 0.5);
  if (reps.length < 2) return 0;
  const m = reps.reduce((a, b) => a + b, 0) / reps.length;
  const v = reps.reduce((a, b) => a + (b - m) * (b - m), 0) / reps.length;
  return Math.sqrt(v);
}
function centralizationOf(rt: Record<string, AgentRuntime>): number {
  const reps = Object.values(rt).map((r) => r.core?.reputation ?? 0.5).sort((a, b) => b - a);
  if (!reps.length) return 0;
  const top = reps.slice(0, Math.max(1, Math.floor(reps.length * 0.25)));
  const topSum = top.reduce((a, b) => a + b, 0);
  const total = reps.reduce((a, b) => a + b, 0) || 1;
  return topSum / total;
}

export function ScenarioOutlookCard({ sim }: { sim: Simulation | undefined }) {
  const [enabled, setEnabled] = useState(false);
  const [running, setRunning] = useState(false);
  const [outcomes, setOutcomes] = useState<OutcomeRow[] | null>(null);
  const [disabled, setDisabled] = useState(false);

  async function runTrials() {
    if (!sim?.runtime || disabled) return;
    setRunning(true);
    setOutcomes(null);
    try {
      const baseSeed = typeof sim.prngSeed === "number" ? sim.prngSeed : 42;
      const rounds = Math.max(2, sim.rounds.length || 4);
      const samples: { trust: number; ineq: number; pol: number; centr: number }[] = [];
      const start = performance.now();
      for (let t = 0; t < 5; t++) {
        const seed = (baseSeed + t + 1) | 0;
        setSimulationSeed(seed);
        const rt: Record<string, AgentRuntime> = JSON.parse(JSON.stringify(sim.runtime));
        for (let r = 0; r < rounds; r++) {
          applyV5Round(rt, r, rounds, { episodicReplay: false });
          // chunk yield to keep UI responsive
          if (r % 2 === 1) await new Promise((res) => setTimeout(res, 0));
        }
        samples.push({
          trust: trustProxy(rt),
          ineq: inequalityOf(rt),
          pol: polarizationScore(rt),
          centr: centralizationOf(rt),
        });
        if (performance.now() - start > 6000) {
          setDisabled(true);
          toast.error("Forecast mode auto-disabled (slow device).");
          break;
        }
      }
      // Restore deterministic seed for the rest of the run
      setSimulationSeed(baseSeed);
      if (samples.length === 0) return;
      const rows: OutcomeRow[] = (["trust", "ineq", "pol", "centr"] as const).map((k) => {
        const xs = samples.map((s) => s[k]).sort((a, b) => a - b);
        const m = xs.reduce((a, b) => a + b, 0) / xs.length;
        const lo = xs[Math.floor(xs.length * 0.05)] ?? xs[0];
        const hi = xs[Math.ceil(xs.length * 0.95) - 1] ?? xs[xs.length - 1];
        return {
          metric: k,
          mean: +m.toFixed(3),
          low: +lo.toFixed(3),
          high: +hi.toFixed(3),
          err: +Math.max(m - lo, hi - m).toFixed(3),
        };
      });
      setOutcomes(rows);
    } catch (e) {
      console.warn("Forecast mode failed", e);
      toast.error("Forecast mode failed — disabled this session.");
      setDisabled(true);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="glass rounded-2xl p-3 space-y-2">
      <header className="flex items-center justify-between">
        <h2 className="font-display text-base font-semibold">Scenario Outlook</h2>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-muted-foreground">Forecast</span>
          <Switch checked={enabled} onCheckedChange={(v) => setEnabled(v)} disabled={disabled} />
        </div>
      </header>
      <p className="text-[10px] leading-snug text-muted-foreground">
        Based on 5 Monte Carlo trials. For deeper analysis, run multi-trial aggregation.
      </p>
      {disabled && (
        <div className="rounded-xl bg-[oklch(0.92_0.07_55)] px-2 py-1 text-[10px] text-primary">
          ⚠ Auto-disabled due to performance. Re-enable manually if desired.
        </div>
      )}
      {enabled && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={running || !sim?.runtime}
            onClick={runTrials}
            className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {running ? "Running 5 trials…" : outcomes ? "Re-run" : "Run forecast"}
          </button>
          {outcomes && (
            <span className="font-mono text-[10px] text-muted-foreground">
              90% CI · n=5
            </span>
          )}
        </div>
      )}
      {outcomes && (
        <div className="h-[160px] rounded-2xl bg-white/70 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={outcomes} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="metric" tick={{ fontSize: 9 }} stroke="oklch(0.6 0 0)" />
              <YAxis tick={{ fontSize: 9 }} stroke="oklch(0.6 0 0)" domain={[0, 1]} />
              <RTooltip contentStyle={{ fontSize: 10, borderRadius: 8 }} />
              <Bar dataKey="mean" fill="oklch(0.6 0.12 230)">
                <ErrorBar dataKey="err" width={4} stroke="oklch(0.55 0.16 25)" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
