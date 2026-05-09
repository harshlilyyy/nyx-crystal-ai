// v7 Single-perturbation divergence mapping for the BlackSwan Assassin
// Pure function — no persistent state. Perturbs ONE core variable up/down,
// replays the same N rounds, returns aggregate outcome distance + sensitivity.
//
// Perturbation order invariant: perturb → perception → cognition → modulation → caps.

import { applyV5Round, defaultCore } from "./nyx-causal";
import type { AgentRuntime, CoreState, CoreVar } from "./nyx-types";

const OUTCOME_VARS: CoreVar[] = [
  "self_worth", "anxiety", "momentum", "reputation",
  "opportunity_access", "fragility_index", "consistency",
];

export interface DivergenceResult {
  variable: CoreVar;
  direction: "up" | "down";
  perturbationMagnitude: number;
  baselineOutcome: { reputation_mean: number; inequality: number; trust_proxy: number; centralization: number };
  perturbedOutcome: { reputation_mean: number; inequality: number; trust_proxy: number; centralization: number };
  outcomeDistance: number;
  sensitivityScore: number;
  sigmaShift: number;
  classification: "cap-limited" | "network-limited" | "modulation-limited" | "unconstrained";
  cascadePath: string[];
}

function clone(rt: Record<string, AgentRuntime>): Record<string, AgentRuntime> {
  const out: Record<string, AgentRuntime> = {};
  for (const [k, v] of Object.entries(rt)) {
    out[k] = JSON.parse(JSON.stringify(v));
    if (!out[k].core) out[k].core = defaultCore();
  }
  return out;
}

function aggregate(rt: Record<string, AgentRuntime>) {
  const list = Object.values(rt).map((r) => r.core ?? defaultCore());
  const reputation_mean = list.reduce((a, c) => a + c.reputation, 0) / Math.max(1, list.length);
  const reps = list.map((c) => c.reputation);
  const m = reps.reduce((a, b) => a + b, 0) / Math.max(1, reps.length);
  const variance = reps.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, reps.length);
  const inequality = Math.sqrt(variance);
  const trust_proxy = list.reduce((a, c) => a + (1 - c.fragility_index), 0) / Math.max(1, list.length);
  const max = Math.max(...reps, 0.0001);
  const centralization = max > 0 ? (max - m) / max : 0;
  return { reputation_mean, inequality, trust_proxy, centralization };
}

function l2(a: { reputation_mean: number; inequality: number; trust_proxy: number; centralization: number },
            b: { reputation_mean: number; inequality: number; trust_proxy: number; centralization: number }): number {
  const d1 = a.reputation_mean - b.reputation_mean;
  const d2 = a.inequality - b.inequality;
  const d3 = a.trust_proxy - b.trust_proxy;
  const d4 = a.centralization - b.centralization;
  return Math.sqrt(d1 * d1 + d2 * d2 + d3 * d3 + d4 * d4);
}

function replay(base: Record<string, AgentRuntime>, rounds: number, perturb?: { variable: CoreVar; delta: number }) {
  const rt = clone(base);
  if (perturb) {
    for (const r of Object.values(rt)) {
      if (!r.core) r.core = defaultCore();
      const cur = (r.core[perturb.variable] as number) ?? 0;
      r.core[perturb.variable] = Math.max(0, Math.min(1, cur + perturb.delta)) as never;
    }
  }
  let capTriggered = false;
  let modulated = false;
  const cascadeAgents = new Set<string>();
  for (let i = 0; i < rounds; i++) {
    applyV5Round(rt, i, rounds);
    for (const r of Object.values(rt)) {
      if (r.dampingDiagnostics?.reputationCapTriggered || r.dampingDiagnostics?.opportunityCapTriggered) capTriggered = true;
      if (r.lastDissonanceAmplified) modulated = true;
      if (r.cascade) cascadeAgents.add(r.agentId);
    }
  }
  return { rt, capTriggered, modulated, cascadeAgents: [...cascadeAgents] };
}

function networkSat(rt: Record<string, AgentRuntime>): number {
  const list = Object.values(rt).map((r) => r.core ?? defaultCore());
  if (!list.length) return 0;
  return list.reduce((a, c) => a + (c.reputation + c.opportunity_access) / 2, 0) / list.length;
}

export function runDivergence(
  baseRuntime: Record<string, AgentRuntime>,
  variable: CoreVar,
  direction: "up" | "down",
  rounds: number,
): DivergenceResult {
  const r = Math.max(1, Math.min(rounds, 8));
  const magnitude = 0.20;
  const delta = direction === "up" ? magnitude : -magnitude;

  const baseline = replay(baseRuntime, r);
  const perturbed = replay(baseRuntime, r, { variable, delta });

  const baseOut = aggregate(baseline.rt);
  const pertOut = aggregate(perturbed.rt);
  const distance = l2(pertOut, baseOut);
  const sensitivity = distance / Math.max(0.001, magnitude);

  // sigma_shift: distance expressed in baseline-rep stddev units
  const reps = Object.values(baseline.rt).map((x) => x.core?.reputation ?? 0);
  const m = reps.reduce((a, b) => a + b, 0) / Math.max(1, reps.length);
  const variance = reps.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, reps.length);
  const sigma = Math.max(0.01, Math.sqrt(variance));
  const sigmaShift = distance / sigma;

  let classification: DivergenceResult["classification"] = "unconstrained";
  if (perturbed.capTriggered) classification = "cap-limited";
  else if (networkSat(perturbed.rt) > 0.5) classification = "network-limited";
  else if (perturbed.modulated) classification = "modulation-limited";

  return {
    variable,
    direction,
    perturbationMagnitude: magnitude,
    baselineOutcome: {
      reputation_mean: +baseOut.reputation_mean.toFixed(4),
      inequality: +baseOut.inequality.toFixed(4),
      trust_proxy: +baseOut.trust_proxy.toFixed(4),
      centralization: +baseOut.centralization.toFixed(4),
    },
    perturbedOutcome: {
      reputation_mean: +pertOut.reputation_mean.toFixed(4),
      inequality: +pertOut.inequality.toFixed(4),
      trust_proxy: +pertOut.trust_proxy.toFixed(4),
      centralization: +pertOut.centralization.toFixed(4),
    },
    outcomeDistance: +distance.toFixed(4),
    sensitivityScore: +sensitivity.toFixed(4),
    sigmaShift: +sigmaShift.toFixed(3),
    classification,
    cascadePath: perturbed.cascadeAgents,
  };
}

// Helper: Coerce free-form variable label to a CoreVar (best-effort).
export function coerceCoreVar(input: string | undefined | null): CoreVar | null {
  if (!input) return null;
  const v = input.trim().toLowerCase().replace(/[\s-]/g, "_");
  const known: CoreVar[] = [
    "self_worth", "anxiety", "consistency", "momentum", "reputation",
    "opportunity_access", "fragility_index", "lock_in", "learning_rate", "energy",
    "phenomenological_penetration",
  ];
  if ((known as string[]).includes(v)) return v as CoreVar;
  return null;
}
