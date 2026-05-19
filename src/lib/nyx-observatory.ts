// nyx-observatory.ts — Lightweight observability & interpretability layer.
// Pure functions; derived from existing runtime/history; no persistence.
import type { AgentRuntime, CoreState, CoreVar } from "./nyx-types";
import type { StabilityReport, StrategyBucket } from "./nyx-complex";

export type RegimeLabel =
  | "Stable Convergence"
  | "Polarized Stalemate"
  | "Fragmented Failure"
  | "Cascading Breakdown"
  | "Transitional";

export interface ForceContribution {
  variable: CoreVar;
  delta: number;       // signed mean delta across agents
  absImpact: number;   // |delta| * weight
  direction: "up" | "down";
}

export interface ObservatorySnapshot {
  round: number;
  regime: RegimeLabel;
  dominantForces: ForceContribution[]; // top 5
  topAgents: { agentId: string; absRepDelta: number; absWorthDelta: number }[];
  emergence: string[];                  // active emergent-pattern badges
  radar: {
    trust: number;            // 0..1 higher better
    entropyHealth: number;    // 0..1 higher = more diverse modes
    polarizationCalm: number; // 0..1 higher = less polarized
    centralizationBalance: number; // 0..1 higher = balanced
    cascadeCalm: number;      // 0..1 higher = less cascade pressure
  };
  cascadeTriggered: boolean;
  trust: number;
  polarization: number;
  entropy: number;
}

const CORE_VARS: CoreVar[] = [
  "reputation", "self_worth", "anxiety", "consistency", "momentum",
  "opportunity_access", "fragility_index", "lock_in", "energy",
];

const VAR_WEIGHT: Partial<Record<CoreVar, number>> = {
  reputation: 1.2,
  self_worth: 1.1,
  anxiety: 1.0,
  opportunity_access: 0.9,
  momentum: 0.8,
  consistency: 0.7,
  fragility_index: 0.9,
  lock_in: 0.7,
  energy: 0.5,
};

function meanDelta(
  runtime: Record<string, AgentRuntime>,
  prev: Record<string, CoreState>,
  v: CoreVar,
): number {
  let n = 0, sum = 0;
  for (const [id, rt] of Object.entries(runtime)) {
    if (!rt.core || !prev[id]) continue;
    sum += (rt.core[v] - prev[id][v]); n += 1;
  }
  return n ? sum / n : 0;
}

export function computeDominantForces(
  runtime: Record<string, AgentRuntime>,
  prev: Record<string, CoreState>,
): ForceContribution[] {
  const out: ForceContribution[] = CORE_VARS.map((v) => {
    const d = meanDelta(runtime, prev, v);
    const w = VAR_WEIGHT[v] ?? 0.6;
    return { variable: v, delta: d, absImpact: Math.abs(d) * w, direction: d >= 0 ? "up" as const : "down" as const };
  }).sort((a, b) => b.absImpact - a.absImpact).slice(0, 5);
  return out;
}

export function topMovingAgents(
  runtime: Record<string, AgentRuntime>,
  prev: Record<string, CoreState>,
  limit = 3,
) {
  const rows = Object.entries(runtime).map(([id, rt]) => {
    const p = prev[id];
    const rd = p && rt.core ? Math.abs(rt.core.reputation - p.reputation) : 0;
    const wd = p && rt.core ? Math.abs(rt.core.self_worth - p.self_worth) : 0;
    return { agentId: id, absRepDelta: rd, absWorthDelta: wd };
  });
  rows.sort((a, b) => (b.absRepDelta + b.absWorthDelta) - (a.absRepDelta + a.absWorthDelta));
  return rows.slice(0, limit);
}

export function detectRegime(
  trust: number,
  polarization: number,
  entropy: number,
  stability: StabilityReport | null,
  cascadeTriggered: boolean,
  recentCascade: boolean,
): RegimeLabel {
  if (cascadeTriggered || (recentCascade && stability?.instability)) return "Cascading Breakdown";
  if (trust < 0.35 && entropy > 1.2) return "Fragmented Failure";
  if (polarization > 0.16 && (stability?.instability || polarization > 0.22)) return "Polarized Stalemate";
  if (entropy < 0.85 && trust >= 0.55 && !stability?.slowing) return "Stable Convergence";
  return "Transitional";
}

export function detectEmergence(
  runtime: Record<string, AgentRuntime>,
  influenceNetwork: Record<string, Record<string, number>>,
  modePrev: Record<StrategyBucket, number> | undefined,
  stability: StabilityReport | null,
  cascadePressure: Record<string, number>,
  lockedRounds: Record<string, number>,
): string[] {
  const flags: string[] = [];
  // Synchronized factions: one strategy >= 60% prevalence
  if (modePrev) {
    const max = Math.max(...Object.values(modePrev));
    if (max >= 0.6) flags.push("Synchronized Faction");
  }
  // Echo chamber: cluster of ≥3 agents sharing same modeV5
  const byMode: Record<string, number> = {};
  for (const rt of Object.values(runtime)) {
    const m = rt.modeV5 ?? "steady"; byMode[m] = (byMode[m] ?? 0) + 1;
  }
  if (Object.values(byMode).some((c) => c >= 3)) flags.push("Echo Chamber");
  // Elite influence concentration: top out-influence > 35% of total
  let total = 0;
  const perAgentOut: Record<string, number> = {};
  for (const [src, dest] of Object.entries(influenceNetwork)) {
    const s = Object.values(dest).reduce((a, b) => a + Math.abs(b), 0);
    perAgentOut[src] = s; total += s;
  }
  if (total > 0) {
    const top = Math.max(...Object.values(perAgentOut));
    if (top / total > 0.35) flags.push("Elite Concentration");
  }
  // Instability loop
  if (stability?.instability && stability?.slowing) flags.push("Instability Loop");
  // Narrative lock-in
  if (Object.values(lockedRounds).some((r) => r >= 3)) flags.push("Narrative Lock-In");
  // Cascade pressure spread
  const pressVals = Object.values(cascadePressure);
  if (pressVals.length && pressVals.filter((p) => p > 0.5).length >= Math.ceil(pressVals.length / 2)) {
    flags.push("Pressure Contagion");
  }
  return flags;
}

export function radarMetrics(
  trust: number,
  polarization: number,
  entropy: number,
  centralization: number,
  cascadePressure: Record<string, number>,
) {
  const maxEntropy = Math.log2(4); // 4 strategy buckets
  const meanCasc = Object.values(cascadePressure).length
    ? Object.values(cascadePressure).reduce((a, b) => a + b, 0) / Object.values(cascadePressure).length
    : 0;
  return {
    trust: clamp01(trust),
    entropyHealth: clamp01(entropy / maxEntropy),
    polarizationCalm: clamp01(1 - polarization * 3.5),
    centralizationBalance: clamp01(1 - Math.abs(centralization - 0.5) * 2),
    cascadeCalm: clamp01(1 - meanCasc),
  };
}

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

export function buildObservatorySnapshot(input: {
  round: number;
  runtime: Record<string, AgentRuntime>;
  prevCore: Record<string, CoreState>;
  trust: number;
  polarization: number;
  entropy: number;
  centralization: number;
  cascadePressure: Record<string, number>;
  modePrev: Record<StrategyBucket, number> | undefined;
  influenceNetwork: Record<string, Record<string, number>>;
  stability: StabilityReport | null;
  lockedRounds: Record<string, number>;
  cascadeTriggered: boolean;
  recentCascade: boolean;
}): ObservatorySnapshot {
  return {
    round: input.round,
    regime: detectRegime(input.trust, input.polarization, input.entropy, input.stability, input.cascadeTriggered, input.recentCascade),
    dominantForces: computeDominantForces(input.runtime, input.prevCore),
    topAgents: topMovingAgents(input.runtime, input.prevCore),
    emergence: detectEmergence(input.runtime, input.influenceNetwork, input.modePrev, input.stability, input.cascadePressure, input.lockedRounds),
    radar: radarMetrics(input.trust, input.polarization, input.entropy, input.centralization, input.cascadePressure),
    cascadeTriggered: input.cascadeTriggered,
    trust: input.trust,
    polarization: input.polarization,
    entropy: input.entropy,
  };
}

export function causalTraceback(
  history: ObservatorySnapshot[],
  agentNameLookup: (id: string) => string,
): string {
  if (!history.length) return "Insufficient telemetry for traceback.";
  // Aggregate top variables across rounds by total absImpact
  const agg: Record<string, number> = {};
  for (const s of history) {
    for (const f of s.dominantForces) agg[f.variable] = (agg[f.variable] ?? 0) + f.absImpact;
  }
  const topVars = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v]) => v);
  // Top agent (most cumulative movement)
  const agentAgg: Record<string, number> = {};
  for (const s of history) {
    for (const a of s.topAgents) agentAgg[a.agentId] = (agentAgg[a.agentId] ?? 0) + a.absRepDelta + a.absWorthDelta;
  }
  const topAgent = Object.entries(agentAgg).sort((a, b) => b[1] - a[1])[0]?.[0];
  // Critical round = largest single-round trust delta
  let critRound = 0, maxDelta = 0;
  for (let i = 1; i < history.length; i++) {
    const d = Math.abs(history[i].trust - history[i - 1].trust);
    if (d > maxDelta) { maxDelta = d; critRound = history[i].round; }
  }
  const cascadeRounds = history.filter((s) => s.cascadeTriggered).map((s) => s.round + 1);
  const finalRegime = history[history.length - 1].regime;
  return [
    `Outcome regime: ${finalRegime}.`,
    `Primary drivers: ${topVars.join(", ")}.`,
    topAgent ? `Most influential agent: ${agentNameLookup(topAgent)}.` : "",
    `Critical round: ${critRound + 1} (largest trust shift Δ${maxDelta.toFixed(3)}).`,
    cascadeRounds.length ? `Cascade triggers in rounds: ${cascadeRounds.join(", ")}.` : "No cascade events recorded.",
  ].filter(Boolean).join(" ");
}
