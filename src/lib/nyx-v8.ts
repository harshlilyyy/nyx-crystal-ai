// v8 Adaptive Cognition — experimental layer.
// Every helper is gated; if dependencies missing, callers get safe no-ops.

import type { AgentRuntime, CoreState, Simulation } from "./nyx-types";
import { applyV5Round } from "./nyx-causal";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ===== 1. Iterative Settling =====
// Apply one extra modulation pass with decaying weight on conflict-driven terms.
// Core equations are NOT re-applied — only anxiety / contradiction modulation.
export function maybeIterativeSettle(
  rt: AgentRuntime,
  enabled: boolean,
  eventMagnitude: number,
): { iterations: number } {
  if (!enabled) return { iterations: 1 };
  const cs = rt.contradictionScore ?? 0;
  if (cs <= 0.6 || eventMagnitude <= 0.3) return { iterations: 1 };
  if (!rt.core) return { iterations: 1 };
  const weights = [0.6, 0.3]; // pass 1 already applied at weight 1.0
  let prev: CoreState = { ...rt.core };
  let iterations = 1;
  let accum = 0;
  for (const w of weights) {
    const c = rt.core;
    // Re-apply ONLY conflict-driven anxiety modulation (decaying)
    const dissAmp = 1 + 0.4 * cs * w;
    const anxAdj = clamp01(c.anxiety + 0.05 * (dissAmp - 1));
    accum += Math.abs(anxAdj - c.anxiety);
    c.anxiety = anxAdj;
    iterations += 1;
    const delta = Math.abs(c.anxiety - prev.anxiety) +
      Math.abs(c.self_worth - prev.self_worth) +
      Math.abs(c.momentum - prev.momentum);
    if (delta < 0.02) break;
    prev = { ...c };
  }
  // Global modulation cap on accumulated change
  if (accum > 0.15) rt.core.anxiety = clamp01(rt.core.anxiety - (accum - 0.15));
  rt.iterationCount = iterations;
  return { iterations };
}

// ===== 3. Hard Active Dissonance =====
// Once-per-sim, when cs>0.8 for 3 consecutive rounds, allow self_worth jump.
export function maybeHardDissonance(rt: AgentRuntime, enabled: boolean): boolean {
  if (!enabled || !rt.core) return false;
  const cs = rt.contradictionScore ?? 0;
  if (cs > 0.8) rt.highContradictionStreak = (rt.highContradictionStreak ?? 0) + 1;
  else rt.highContradictionStreak = 0;
  if (rt.hardDissonanceUsed) { rt.hardDissonanceTriggered = false; return false; }
  if ((rt.highContradictionStreak ?? 0) >= 3) {
    // resolution_dir: sign of (self_worth - 0.5)
    const dir = rt.core.self_worth >= 0.5 ? 1 : -1;
    rt.core.self_worth = clamp01(rt.core.self_worth + 0.3 * dir);
    rt.hardDissonanceUsed = true;
    rt.hardDissonanceTriggered = true;
    rt.highContradictionStreak = 0;
    return true;
  }
  rt.hardDissonanceTriggered = false;
  return false;
}

// ===== 4. Cross-Agent Belief Modeling =====
// Each agent i maintains an EMA of perceived_self_by_j using j→i existence value.
export function updateBeliefModeling(
  runtime: Record<string, AgentRuntime>,
  enabled: boolean,
): void {
  if (!enabled) return;
  const ids = Object.keys(runtime);
  // Build i→j existence map from each agent's perspective using core distances.
  for (const i of ids) {
    const ri = runtime[i];
    if (!ri.core) continue;
    const map = ri.perceivedSelfByJ ?? {};
    for (const j of ids) {
      if (j === i) continue;
      const rj = runtime[j];
      if (!rj.core) continue;
      // ev_ji approximated as (1 - |rep_i - rep_j|) * rj.consistency
      const ev = clamp01((1 - Math.abs((ri.core.reputation) - (rj.core.reputation))) * rj.core.consistency);
      const prev = map[j] ?? 0.5;
      map[j] = +(0.7 * prev + 0.3 * ev).toFixed(4);
    }
    ri.perceivedSelfByJ = map;
    // Modulate social anxiety: low average belief → small anxiety bump
    const vals = Object.values(map);
    if (vals.length) {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      ri.core.anxiety = clamp01(ri.core.anxiety + 0.02 * (0.5 - avg));
    }
  }
}

// ===== 2. Multi-Run Probability Cloud =====
export interface CloudPoint {
  reputation_mean: number;
  inequality: number;
  trust_proxy: number;
  centralization: number;
}
export interface CloudResult {
  runs: number;
  points: CloudPoint[];
  byMetric: Record<keyof CloudPoint, { min: number; max: number; mean: number; p25: number; p50: number; p75: number }>;
}

function jitterCore(c: CoreState, pct = 0.05, rng: () => number = Math.random): CoreState {
  const j = (v: number) => clamp01(v * (1 + (rng() * 2 - 1) * pct));
  return {
    ...c,
    self_worth: j(c.self_worth),
    anxiety: j(c.anxiety),
    consistency: j(c.consistency),
    momentum: j(c.momentum),
    reputation: j(c.reputation),
    opportunity_access: j(c.opportunity_access),
    fragility_index: j(c.fragility_index),
    lock_in: j(c.lock_in),
    learning_rate: j(c.learning_rate),
    energy: j(c.energy),
    phenomenological_penetration: j(c.phenomenological_penetration ?? 0.5),
  };
}

function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  return { min: sorted[0], max: sorted[sorted.length - 1], mean, p25: q(0.25), p50: q(0.5), p75: q(0.75) };
}

export async function runProbabilityCloud(
  baseRuntime: Record<string, AgentRuntime>,
  rounds: number,
  opts: { runs?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<CloudResult | null> {
  const ids = Object.keys(baseRuntime);
  if (ids.length > 50) return null; // auto-disable
  const runs = Math.max(30, Math.min(50, opts.runs ?? 30));
  const points: CloudPoint[] = [];
  for (let r = 0; r < runs; r++) {
    // Deep-clone runtime with jittered cores
    const rt: Record<string, AgentRuntime> = {};
    for (const id of ids) {
      const src = baseRuntime[id];
      rt[id] = {
        ...src,
        core: src.core ? jitterCore(src.core, 0.05) : undefined,
        history: [...(src.history ?? [])],
        episodicBuffer: [],
        pendingIntent: undefined,
        successStreak: 0, failureStreak: 0,
      };
    }
    for (let i = 0; i < rounds; i++) {
      try { applyV5Round(rt, i, rounds); } catch { /* skip */ }
    }
    const cores = Object.values(rt).map((x) => x.core).filter(Boolean) as CoreState[];
    if (!cores.length) continue;
    const reps = cores.map((c) => c.reputation);
    const mean = reps.reduce((a, b) => a + b, 0) / reps.length;
    const sorted = [...reps].sort((a, b) => a - b);
    const inequality = sorted[sorted.length - 1] - sorted[0];
    const trust = cores.reduce((a, c) => a + (1 - c.anxiety), 0) / cores.length;
    const central = sorted[sorted.length - 1] - mean;
    points.push({ reputation_mean: mean, inequality, trust_proxy: trust, centralization: central });
    opts.onProgress?.(r + 1, runs);
    if (r % 5 === 0) await new Promise((res) => setTimeout(res, 0));
  }
  const byMetric = {
    reputation_mean: summarize(points.map((p) => p.reputation_mean)),
    inequality: summarize(points.map((p) => p.inequality)),
    trust_proxy: summarize(points.map((p) => p.trust_proxy)),
    centralization: summarize(points.map((p) => p.centralization)),
  };
  return { runs: points.length, points, byMetric };
}

// ===== 5. OASIS backend =====
export async function checkOasisReachable(endpoint?: string): Promise<boolean> {
  if (!endpoint) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`${endpoint.replace(/\/$/, "")}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

// ===== 6. Game-Theoretic Analysis =====
// Uses Lovable AI Gateway via existing nyx-ai edge function ("game_theory" task).
export async function runGameTheoryAnalysis(
  sim: Simulation,
): Promise<Simulation["gameTheory"] | null> {
  if (!sim.runtime) return null;
  const { supabase } = await import("@/integrations/supabase/client");
  const agents = Object.values(sim.runtime).map((rt) => ({
    agentId: rt.agentId,
    mode: rt.modeV5 ?? rt.mode,
    self_worth: rt.core?.self_worth ?? 0,
    reputation: rt.core?.reputation ?? 0,
    momentum: rt.core?.momentum ?? 0,
    anxiety: rt.core?.anxiety ?? 0,
    intent: rt.lastIntent?.type ?? null,
  }));
  try {
    const { data, error } = await supabase.functions.invoke("nyx-ai", {
      body: { task: "game_theory", seed: sim.seed, agents, rounds: sim.rounds.length },
    });
    if (error || !data) return null;
    return {
      nashEquilibria: data.nashEquilibria ?? [],
      dominantStrategies: data.dominantStrategies ?? [],
      paretoFrontier: data.paretoFrontier ?? [],
      rationalityGap: data.rationalityGap ?? "",
      summary: data.summary ?? "",
    };
  } catch {
    return null;
  }
}
