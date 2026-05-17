// DominantStrategiesCard — Replicator dynamics history (Outcomes tab).
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip as RTooltip, Legend } from "recharts";
import { STRATEGY_BUCKETS, type StrategyBucket } from "@/lib/nyx-complex";

const COLORS: Record<StrategyBucket, string> = {
  AVOID: "#C26B6B",
  RECOVER: "#6FA984",
  EXECUTE: "#6E8FC4",
  OPTIMIZE: "#A77BC2",
};

export function DominantStrategiesCard({
  history,
}: {
  history: Record<StrategyBucket, number>[];
}) {
  if (!history.length) {
    return (
      <section className="glass rounded-2xl p-3">
        <h2 className="font-display text-base font-semibold">Dominant Strategies</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Requires advanced simulation with v5 runtime. No history yet.
        </p>
      </section>
    );
  }
  const data = history.map((row, i) => ({ round: i + 1, ...row }));
  return (
    <section className="glass rounded-2xl p-3">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-base font-semibold">Dominant Strategies</h2>
        <span className="font-mono text-[9px] text-muted-foreground">replicator · soft</span>
      </header>
      <p className="mb-1 text-[10px] leading-snug text-muted-foreground">
        Mode prevalence per round. Replicator dynamics nudge agents toward
        historically successful strategies (clamped 0.05–0.7).
      </p>
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="round" tick={{ fontSize: 9 }} stroke="oklch(0.6 0 0)" />
            <YAxis domain={[0, 1]} tick={{ fontSize: 9 }} stroke="oklch(0.6 0 0)" />
            <RTooltip contentStyle={{ fontSize: 10, borderRadius: 8 }} />
            <Legend wrapperStyle={{ fontSize: 9 }} iconSize={8} />
            {STRATEGY_BUCKETS.map((k) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                stroke={COLORS[k]}
                strokeWidth={1.7}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
