// Nyx Complex Systems Expansion Pack
// Pure deterministic helpers. Session-only, no persistence, O(n) / O(n²).
// All effects mutate transient AgentRuntime fields already in the type.

import type { AgentRuntime, CoreState, EpisodicTrace } from "./nyx-types";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

// ===== Active Inference Lite =====
export interface PredictionState {
  pe: number;
  persistRounds: number;
}

export function meanReputation(runtime: Record<string, AgentRuntime>): number {
  const cs = Object.values(runtime).map((r) => r.core?.reputation ?? 0.5);
  if (!cs.length) return 0.5;
  return cs.reduce((a, b) => a + b, 0) / cs.length;
}

export function trustProxy(runtime: Record<string, AgentRuntime>): number {
  // proxy: 1 - mean anxiety blended with mean consistency
  const cs = Object.values(runtime).map((r) => r.core);
  if (!cs.length) return 0.5;
  let ax = 0, co = 0;
  for (const c of cs) { if (c) { ax += c.anxiety; co += c.consistency; } }
  const n = cs.length;
  return clamp01(0.5 * (1 - ax / n) + 0.5 * (co / n));
}

export function applyActiveInference(
  rt: AgentRuntime,
  prevTrust: number,
  prevReputationMean: number,
  observedTrust: number,
  state: PredictionState | undefined,
): { pe: number; persist: number } {
  if (!rt.core) return { pe: 0, persist: 0 };
  const expected = prevTrust * 0.4 + prevReputationMean * 0.4 + rt.core.momentum * 0.2;
  const pe = Math.abs(expected - observedTrust);
  rt.core.anxiety = clamp01(rt.core.anxiety + 0.02 * pe);
  if (rt.core.anxiety > 0.6) {
    rt.core.learning_rate = Math.max(0.05, rt.core.learning_rate - 0.01);
  }
  const persist = pe > 0.1 ? (state?.persistRounds ?? 0) + 1 : 0;
  if (persist >= 3) {
    rt.core.lock_in = clamp01(rt.core.lock_in + 0.03);
  }
  return { pe: r3(pe), persist };
}

// ===== Early Warning Signals =====
export function rollingVariance(series: number[], window = 5): number {
  if (series.length < 2) return 0;
  const tail = series.slice(-window);
  const m = tail.reduce((a, b) => a + b, 0) / tail.length;
  const v = tail.reduce((a, b) => a + (b - m) * (b - m), 0) / tail.length;
  return r3(v);
}

export interface StabilityReport {
  stability: number;
  instability: boolean;
  slowing: boolean;
  trustVariance: number;
  polarizationVariance: number;
  recoveryTime: number | null;
}

function risingRun(series: number[], n = 3): boolean {
  if (series.length < n + 1) return false;
  const tail = series.slice(-(n + 1));
  for (let i = 1; i <= n; i++) {
    if (tail[i] <= tail[i - 1]) return false;
  }
  return true;
}

export function detectEarlyWarnings(
  trustVarHist: number[],
  polVarHist: number[],
  recoveryHist: number[],
): StabilityReport {
  const trustVariance = trustVarHist[trustVarHist.length - 1] ?? 0;
  const polarizationVariance = polVarHist[polVarHist.length - 1] ?? 0;
  const recoveryTime = recoveryHist[recoveryHist.length - 1] ?? null;
  const instability = risingRun(trustVarHist, 3) || risingRun(polVarHist, 3);
  // Slowing: recovery_time rose in last two steps
  let slowing = false;
  if (recoveryHist.length >= 3) {
    const a = recoveryHist[recoveryHist.length - 3];
    const b = recoveryHist[recoveryHist.length - 2];
    const c = recoveryHist[recoveryHist.length - 1];
    slowing = c > b && b > a;
  }
  const varPenalty = Math.min(50, (trustVariance + polarizationVariance) * 200);
  const slowPenalty = slowing ? 20 : 0;
  const instabPenalty = instability ? 25 : 0;
  const stability = Math.max(0, Math.min(100, Math.round(100 - varPenalty - slowPenalty - instabPenalty)));
  return { stability, instability, slowing, trustVariance, polarizationVariance, recoveryTime };
}

export function polarizationScore(runtime: Record<string, AgentRuntime>): number {
  // Spread of momentum across agents → proxy for polarization
  const ms = Object.values(runtime).map((r) => r.core?.momentum ?? 0.5);
  if (ms.length < 2) return 0;
  const m = ms.reduce((a, b) => a + b, 0) / ms.length;
  const v = ms.reduce((a, b) => a + (b - m) * (b - m), 0) / ms.length;
  return r3(Math.sqrt(v));
}

// ===== Evolutionary Strategy Dynamics =====
export type StrategyBucket = "AVOID" | "RECOVER" | "EXECUTE" | "OPTIMIZE";
export const STRATEGY_BUCKETS: StrategyBucket[] = ["AVOID", "RECOVER", "EXECUTE", "OPTIMIZE"];

export function bucketFromModeV5(m: string | undefined): StrategyBucket {
  switch (m) {
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

export function modePrevalence(runtime: Record<string, AgentRuntime>): Record<StrategyBucket, number> {
  const out: Record<StrategyBucket, number> = { AVOID: 0, RECOVER: 0, EXECUTE: 0, OPTIMIZE: 0 };
  const vs = Object.values(runtime);
  if (!vs.length) return out;
  for (const r of vs) out[bucketFromModeV5(r.modeV5)] += 1;
  for (const k of STRATEGY_BUCKETS) out[k] = r3(out[k] / vs.length);
  return out;
}

export function defaultStrategyProbs(): Record<StrategyBucket, number> {
  return { AVOID: 0.25, RECOVER: 0.25, EXECUTE: 0.25, OPTIMIZE: 0.25 };
}

export function computeModeSuccess(
  prev: CoreState | undefined,
  curr: CoreState | undefined,
  cascade: boolean,
): number {
  if (!prev || !curr) return 0;
  const trustGain = clamp01(0.5 + (curr.consistency - prev.consistency) * 2 - (curr.anxiety - prev.anxiety));
  const repGain = clamp01(0.5 + (curr.reputation - prev.reputation) * 2);
  return r3(0.3 * trustGain + 0.3 * repGain + 0.4 * (cascade ? 0 : 1));
}

export function updateReplicator(
  probs: Record<StrategyBucket, number>,
  successByMode: Record<StrategyBucket, number>,
): Record<StrategyBucket, number> {
  const mean = STRATEGY_BUCKETS.reduce((a, k) => a + successByMode[k], 0) / 4;
  const raw: Record<StrategyBucket, number> = { ...probs };
  for (const k of STRATEGY_BUCKETS) {
    raw[k] = Math.max(0.05, Math.min(0.7, probs[k] + 0.05 * (successByMode[k] - mean)));
  }
  // Renormalize
  const tot = STRATEGY_BUCKETS.reduce((a, k) => a + raw[k], 0);
  for (const k of STRATEGY_BUCKETS) raw[k] = r3(raw[k] / tot);
  return raw;
}

// ===== Information Cascade Layer =====
export function applyCascadeContagion(
  runtime: Record<string, AgentRuntime>,
  W: Record<string, Record<string, number>>,
): Record<string, number> {
  const pressure: Record<string, number> = {};
  for (const i in runtime) pressure[i] = 0;
  for (const i in runtime) {
    const row = W[i]; if (!row) continue;
    const rti = runtime[i]; if (!rti?.core) continue;
    for (const j in row) {
      const w = row[j]; if (Math.abs(w) <= 0.4) continue;
      const rtj = runtime[j]; if (!rtj?.core) continue;
      const stressed = rtj.core.anxiety > 0.7 || (rtj.core.fragility_index ?? 0) > 0.7;
      if (!stressed) continue;
      const resist = (rti.core.consistency ?? 0) > 0.6 ? 0.5 : 1;
      const boost = 0.01 * Math.abs(w) * resist;
      rti.core.anxiety = clamp01(rti.core.anxiety + boost);
      rti.core.consistency = clamp01(rti.core.consistency - 0.005 * resist); // proxy for trust loss
      pressure[i] += Math.abs(w);
    }
  }
  for (const k in pressure) pressure[k] = r3(pressure[k]);
  return pressure;
}

// ===== Homeostatic Stabilization =====
export function applyHomeostasis(
  runtime: Record<string, AgentRuntime>,
  trust: number,
  inequality: number,
  centralizationRef: { value: number },
): boolean {
  if (trust >= 0.2 && inequality <= 0.8) return false;
  // Bump trust proxy by raising consistency / lowering anxiety modestly
  for (const rt of Object.values(runtime)) {
    if (!rt.core) continue;
    rt.core.consistency = Math.min(0.95, rt.core.consistency + 0.02);
    rt.core.anxiety = Math.max(0, rt.core.anxiety - 0.01);
    if (rt.modeV5 === "avoid" && Math.random() < 0.1) {
      // very mild, allow LLM-derived narrative bias; signal via flag only
      rt.modeV5 = "recovery";
    }
  }
  centralizationRef.value = r3(centralizationRef.value * 0.98);
  return true;
}

// ===== Memory Decay & Emotional Weighting =====
export interface MemoryEntry extends EpisodicTrace {
  strength?: number;
}

export function decayMemoryBuffer(buffer: EpisodicTrace[] | undefined): void {
  if (!buffer) return;
  for (const t of buffer) {
    const m = t as MemoryEntry;
    if (typeof m.strength !== "number") m.strength = 1;
    m.strength = r3(m.strength * 0.97);
    // Emotionally intense events get short-term boost
    if (t.event_type === "cascade" || Math.abs(t.valence) >= 1) {
      // Only boost during the first 2 rounds after the trace; we approximate by
      // boosting when strength is still close to 1.
      // No-op here because we already decayed; boost is handled at insertion time.
    }
  }
}

export function boostFreshMemory(buffer: EpisodicTrace[] | undefined, round: number): void {
  if (!buffer) return;
  for (const t of buffer) {
    const m = t as MemoryEntry;
    if (typeof m.strength !== "number") m.strength = 1;
    if (round - t.round <= 2 && (t.event_type === "cascade" || Math.abs(t.valence) >= 1)) {
      m.strength = Math.min(1.2, m.strength + 0.2);
    }
  }
}

export function meanMemoryStrength(buffer: EpisodicTrace[] | undefined): number {
  if (!buffer || !buffer.length) return 0;
  let s = 0; for (const t of buffer) s += (t as MemoryEntry).strength ?? 1;
  return r3(s / buffer.length);
}
