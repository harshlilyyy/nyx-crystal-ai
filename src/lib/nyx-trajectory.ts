// Trajectory difference analysis — derives verdict-mode classification and
// hard verdict rules from deterministic kernel state history. Pure functions,
// no persistent state.

import type { RoundState, OutcomeVector } from "@/hooks/useNyxKernel";

export type VerdictMode =
  | "STABLE_CONVERGENCE"
  | "POLARIZED_STALEMATE"
  | "FRAGMENTED_FAILURE"
  | "CENTRALIZED_CONTROL"
  | "ADAPTIVE_COMPROMISE"
  | "CASCADING_BREAKDOWN"
  | "STRUCTURAL_DRIFT";

export interface TrajectoryMetrics {
  deltaReputationMean: number;
  deltaInequality: number;
  deltaTrustProxy: number;
  deltaCentralization: number;
  polarizationScore: number;
  convergenceScore: number;
  instabilityIndex: number;
  dominantTrend: "stabilizing" | "fragmenting" | "centralizing" | "volatile" | "drift";
  verdictMode: VerdictMode;
  finalCentralization: number;
  hardRules: string[];
}

function std(values: number[]): number {
  if (values.length === 0) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - m) * (b - m), 0) / values.length;
  return Math.sqrt(v);
}

export function computeTrajectoryMetrics(
  history: RoundState[],
  outcome: OutcomeVector,
): TrajectoryMetrics | null {
  if (!history || history.length === 0) return null;
  const first = history[0];
  const last = history[history.length - 1];

  const worldFirst = first.world;
  const worldLast = last.world;

  const deltaReputationMean = worldLast.reputation_mean - worldFirst.reputation_mean;
  const deltaInequality = worldLast.inequality - worldFirst.inequality;
  const deltaTrustProxy = worldLast.trust_proxy - worldFirst.trust_proxy;
  const deltaCentralization = worldLast.centralization - worldFirst.centralization;

  const finalSelfWorths = Object.values(last.agents).map((a) => a.self_worth);
  const polarizationScore = std(finalSelfWorths);
  const convergenceScore = Math.max(0, 1 - polarizationScore);

  // instability_index = mean of |round-to-round world-state deltas|
  let totalAbs = 0;
  let count = 0;
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1].world;
    const b = history[i].world;
    totalAbs +=
      Math.abs(b.reputation_mean - a.reputation_mean) +
      Math.abs(b.inequality - a.inequality) +
      Math.abs(b.trust_proxy - a.trust_proxy) +
      Math.abs(b.centralization - a.centralization);
    count += 4;
  }
  const instabilityIndex = count > 0 ? totalAbs / count : 0;
  const finalCentralization = outcome.centralization;

  let dominantTrend: TrajectoryMetrics["dominantTrend"] = "drift";
  if (deltaTrustProxy > 0 && deltaInequality < 0) dominantTrend = "stabilizing";
  else if (deltaInequality > 0 && deltaTrustProxy < 0) dominantTrend = "fragmenting";
  else if (finalCentralization > 0.6) dominantTrend = "centralizing";
  else if (instabilityIndex > 0.3) dominantTrend = "volatile";

  // Verdict mode (priority order)
  let verdictMode: VerdictMode = "STRUCTURAL_DRIFT";
  if (
    convergenceScore > 0.7 &&
    instabilityIndex < 0.2 &&
    deltaTrustProxy > -0.1
  ) {
    verdictMode = "STABLE_CONVERGENCE";
  } else if (instabilityIndex > 0.3 && deltaTrustProxy < -0.15) {
    verdictMode = "CASCADING_BREAKDOWN";
  } else if (deltaTrustProxy < -0.15 && deltaInequality > 0.15) {
    verdictMode = "FRAGMENTED_FAILURE";
  } else if (polarizationScore > 0.5) {
    verdictMode = "POLARIZED_STALEMATE";
  } else if (finalCentralization > 0.6) {
    verdictMode = "CENTRALIZED_CONTROL";
  } else if (
    convergenceScore >= 0.4 &&
    convergenceScore <= 0.7 &&
    instabilityIndex >= 0.2 &&
    instabilityIndex <= 0.3
  ) {
    verdictMode = "ADAPTIVE_COMPROMISE";
  }

  const hardRules: string[] = [];
  if (polarizationScore > 0.5) {
    hardRules.push(
      'FORBIDDEN WORDS: do not use "consensus", "balanced", "widely agreed", "common ground", or "middle path".',
    );
  }
  if (deltaTrustProxy < -0.15) {
    hardRules.push(
      "REQUIRED: explicitly mention institutional distrust, coordination breakdown, or trust erosion.",
    );
  }
  if (deltaInequality > 0.15) {
    hardRules.push(
      "REQUIRED: explicitly mention uneven impact, asymmetry, stakeholder imbalance, or winner-takes-all dynamics.",
    );
  }
  if (finalCentralization > 0.6) {
    hardRules.push(
      "REQUIRED: explicitly mention power concentration, authority consolidation, or control centralization.",
    );
  }
  if (instabilityIndex > 0.3) {
    hardRules.push(
      'REQUIRED: include systemic-fragility language (e.g. "prone to disruption", "unstable equilibrium", "cascade-sensitive").',
    );
  }
  if (
    convergenceScore > 0.7 &&
    instabilityIndex < 0.2 &&
    deltaTrustProxy > -0.1
  ) {
    hardRules.push(
      'PERMITTED: "stable consensus" or "broad alignment" wording is allowed (and only in this case).',
    );
  } else {
    hardRules.push(
      'FORBIDDEN: do not claim "stable consensus" or "broad alignment" — kernel metrics do not support it.',
    );
  }

  return {
    deltaReputationMean,
    deltaInequality,
    deltaTrustProxy,
    deltaCentralization,
    polarizationScore,
    convergenceScore,
    instabilityIndex,
    dominantTrend,
    verdictMode,
    finalCentralization,
    hardRules,
  };
}

export const VERDICT_MODE_LABELS: Record<VerdictMode, string> = {
  STABLE_CONVERGENCE: "Stable Convergence",
  POLARIZED_STALEMATE: "Polarized Stalemate",
  FRAGMENTED_FAILURE: "Fragmented Failure",
  CENTRALIZED_CONTROL: "Centralized Control",
  ADAPTIVE_COMPROMISE: "Adaptive Compromise",
  CASCADING_BREAKDOWN: "Cascading Breakdown",
  STRUCTURAL_DRIFT: "Structural Drift",
};

export const VERDICT_MODE_COLORS: Record<VerdictMode, string> = {
  STABLE_CONVERGENCE: "bg-[oklch(0.9_0.05_180)] text-[oklch(0.4_0.06_180)]",
  POLARIZED_STALEMATE: "bg-[oklch(0.93_0.06_25)] text-primary",
  FRAGMENTED_FAILURE: "bg-[oklch(0.92_0.06_25)] text-primary",
  CENTRALIZED_CONTROL: "bg-[oklch(0.93_0.04_300)] text-primary",
  ADAPTIVE_COMPROMISE: "bg-[oklch(0.92_0.04_70)] text-primary",
  CASCADING_BREAKDOWN: "bg-[oklch(0.88_0.09_25)] text-primary",
  STRUCTURAL_DRIFT: "bg-secondary/60 text-secondary-foreground",
};
