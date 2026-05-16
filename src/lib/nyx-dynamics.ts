// Nyx Dynamical-Systems Primitives (advanced-only, derived/transient).
// - Attractor proximity (Hopfield/Kitts-Macy)
// - Heterogeneous cascade thresholds (Granovetter)
// - Narrative entropy (Shannon)
// - Scale-free network init (Barabási–Albert)
//
// Pure deterministic helpers. All stochasticity routes through mulberry32.
// No persistent state. No Math.random.

import { mulberry32 } from "./nyx-causal";
import type { CoreState } from "./nyx-types";

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ===== 1. Attractor centroids =====
// 5-dim agent attractor centroid in (self_worth, anxiety, momentum, consistency, reputation).
export type VerdictMode =
  | "STABLE_CONVERGENCE"
  | "POLARIZED_STALEMATE"
  | "FRAGMENTED_FAILURE"
  | "CENTRALIZED_CONTROL"
  | "ADAPTIVE_COMPROMISE"
  | "CASCADING_BREAKDOWN";

export const ATTRACTOR_CENTROIDS: Record<VerdictMode, [number, number, number, number, number]> = {
  STABLE_CONVERGENCE:   [0.75, 0.25, 0.70, 0.75, 0.70],
  POLARIZED_STALEMATE:  [0.55, 0.55, 0.50, 0.40, 0.55],
  FRAGMENTED_FAILURE:   [0.30, 0.70, 0.25, 0.30, 0.30],
  CENTRALIZED_CONTROL:  [0.65, 0.45, 0.60, 0.65, 0.85],
  ADAPTIVE_COMPROMISE:  [0.65, 0.40, 0.60, 0.65, 0.60],
  CASCADING_BREAKDOWN:  [0.20, 0.85, 0.20, 0.20, 0.25],
};

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom <= 1e-9) return 0;
  return clamp01(dot / denom);
}

export function computeAttractorProximity(c: CoreState, mode: VerdictMode): number {
  const v = [c.self_worth, c.anxiety, c.momentum, c.consistency, c.reputation];
  return r3(cosine(v, ATTRACTOR_CENTROIDS[mode]));
}

// Map modeV5 → verdict mode for proximity comparison.
export function verdictModeFromV5(modeV5: string | undefined): VerdictMode {
  switch (modeV5) {
    case "growth":     return "STABLE_CONVERGENCE";
    case "recovery":   return "ADAPTIVE_COMPROMISE";
    case "fragile":    return "POLARIZED_STALEMATE";
    case "collapse":   return "CASCADING_BREAKDOWN";
    case "spike":      return "CENTRALIZED_CONTROL";
    case "avoid":      return "FRAGMENTED_FAILURE";
    case "steady":     return "STABLE_CONVERGENCE";
    default:           return "STABLE_CONVERGENCE";
  }
}

// ===== 2. Narrative entropy (Shannon over 4 intent modes) =====
export type NarrativeBucket = "AVOID" | "RECOVER" | "EXECUTE" | "OPTIMIZE";

export function bucketFromMode(modeV5: string | undefined): NarrativeBucket {
  switch (modeV5) {
    case "avoid":
    case "collapse":
    case "fragile":
      return "AVOID";
    case "recovery":
      return "RECOVER";
    case "spike":
    case "growth":
      return "OPTIMIZE";
    default:
      return "EXECUTE";
  }
}

export function computeNarrativeEntropy(modes: (string | undefined)[]): number {
  if (modes.length === 0) return 0;
  const counts: Record<NarrativeBucket, number> = { AVOID: 0, RECOVER: 0, EXECUTE: 0, OPTIMIZE: 0 };
  for (const m of modes) counts[bucketFromMode(m)] += 1;
  const total = modes.length;
  let H = 0;
  (Object.keys(counts) as NarrativeBucket[]).forEach((k) => {
    const p = counts[k] / total;
    if (p > 0) H -= p * Math.log2(p + 0.001);
  });
  return r3(H);
}

// ===== 3. Heterogeneous cascade thresholds (Granovetter) =====
// Bounded normal (μ=0.40, σ=0.08), clamped to [0.25, 0.55].
// Deterministic via mulberry32 keyed by seed XOR stringHash(agentId).
function stringHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function boxMuller(rng: () => number): number {
  // Standard normal via Box–Muller (single draw)
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function cascadeThresholdForAgent(seed: number, agentId: string): number {
  const s = ((seed >>> 0) ^ stringHash(agentId)) >>> 0;
  const rng = mulberry32(s);
  const z = boxMuller(rng);
  const v = 0.40 + 0.08 * z;
  return r3(Math.max(0.25, Math.min(0.55, v)));
}

export function cascadeThresholdsForAgents(seed: number, agentIds: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of [...agentIds].sort()) out[id] = cascadeThresholdForAgent(seed, id);
  return out;
}

// ===== 4. Scale-free network (Barabási–Albert) =====
// Start with 3 fully connected seed agents, then each remaining agent adds
// exactly 2 outgoing edges sampled by P(k) = reputation_k / Σ reputations.
// Deterministic via mulberry32(seed).
export function buildScaleFreeNetwork(
  agentIds: string[],
  seed: number,
  reputations: Record<string, number>
): Record<string, Record<string, number>> {
  const ids = [...agentIds].sort();
  const W: Record<string, Record<string, number>> = {};
  for (const id of ids) W[id] = {};
  if (ids.length === 0) return W;

  const rng = mulberry32(seed >>> 0);
  const seedSize = Math.min(3, ids.length);

  // Fully connect seed agents
  for (let i = 0; i < seedSize; i++) {
    for (let j = 0; j < seedSize; j++) {
      if (i === j) continue;
      W[ids[i]][ids[j]] = r3(0.5);
    }
  }

  const sample = (pool: string[]): string => {
    let total = 0;
    for (const k of pool) total += Math.max(0.01, reputations[k] ?? 0.1);
    let pick = rng() * total;
    for (const k of pool) {
      pick -= Math.max(0.01, reputations[k] ?? 0.1);
      if (pick <= 0) return k;
    }
    return pool[pool.length - 1];
  };

  for (let i = seedSize; i < ids.length; i++) {
    const src = ids[i];
    const pool = ids.slice(0, i); // existing nodes only
    const picks = new Set<string>();
    const m = Math.min(2, pool.length);
    let guard = 0;
    while (picks.size < m && guard < 50) {
      picks.add(sample(pool));
      guard++;
    }
    for (const tgt of picks) {
      W[src][tgt] = r3(0.5);
    }
  }
  return W;
}

export function weightedOutDegree(W: Record<string, Record<string, number>>, id: string): number {
  const row = W[id]; if (!row) return 0;
  let s = 0; for (const k in row) s += row[k];
  return r3(s);
}

export function topNetworkHubs(
  W: Record<string, Record<string, number>>,
  k = 3
): { id: string; degree: number }[] {
  // Use weighted in-degree (target popularity) — hubs in BA topology.
  const inDeg: Record<string, number> = {};
  for (const src in W) {
    for (const tgt in W[src]) inDeg[tgt] = (inDeg[tgt] ?? 0) + W[src][tgt];
  }
  return Object.entries(inDeg)
    .map(([id, degree]) => ({ id, degree: r3(degree) }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, k);
}
