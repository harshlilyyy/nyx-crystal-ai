// Three-level Sensitivity Analysis (S_pre_cap, S_raw, S_damped) plus damping
// & suppression diagnostics. Pure function — no persistent state.
//
// Perturbation order invariant: perturb → perception → cognition → modulation → caps.
// We perturb a single core variable at t=0, replay the same N rounds three ways:
//   - S_damped:  full system (caps + modulation ON)
//   - S_pre_cap: caps OFF, modulation ON
//   - S_raw:     caps OFF, modulation OFF
// Outcome = mean across agents of final core vector; distance = L2 vs baseline.

import { applyV5Round, defaultCore } from "./nyx-causal";
import type { AgentRuntime, CoreState, CoreVar } from "./nyx-types";

const PERTURB_VARS: CoreVar[] = [
  "self_worth", "anxiety", "consistency", "momentum", "reputation",
  "opportunity_access", "fragility_index",
];

const OUTCOME_VARS: CoreVar[] = [
  "self_worth", "anxiety", "momentum", "reputation",
  "opportunity_access", "fragility_index", "consistency",
];

const PERTURB_DELTA = 0.15;
const EPS = 1e-6;

export type ConstraintLabel = "cap-limited" | "network-limited" | "modulation-limited" | "unconstrained";

export interface SensitivityRow {
  variable: CoreVar;
  S_pre_cap: number;
  S_raw: number;
  S_damped: number;
  ratio_pre_to_damped: number;       // S_pre_cap / (S_damped + ε)
  classification: ConstraintLabel;
  highValueSuppressed: boolean;      // ratio_pre_to_damped > 5
  capTriggered: boolean;
  saturation: number;                // mean network saturation/competition proxy
}

export interface SensitivitySummary {
  rows: SensitivityRow[];
  damping_attenuation_factor: number; // mean(S_raw / (S_damped + ε))
  damping_ratio: number;              // mean(|S_damped|)
  max_sensitivity_loss: number;       // max(S_pre_cap_i / S_damped_i)
  overDamped: boolean;                // damping_ratio < 0.5
  suppressedVars: CoreVar[];          // vars with sensitivity_loss > 5
  rounds: number;
}

function cloneRuntime(rt: Record<string, AgentRuntime>): Record<string, AgentRuntime> {
  const out: Record<string, AgentRuntime> = {};
  for (const [id, r] of Object.entries(rt)) {
    out[id] = JSON.parse(JSON.stringify(r));
    if (!out[id].core) out[id].core = defaultCore();
  }
  return out;
}

function meanCore(rt: Record<string, AgentRuntime>): Record<CoreVar, number> {
  const acc = {} as Record<CoreVar, number>;
  for (const v of OUTCOME_VARS) acc[v] = 0;
  const list = Object.values(rt);
  for (const r of list) {
    const c = r.core ?? defaultCore();
    for (const v of OUTCOME_VARS) acc[v] += (c[v] as number) ?? 0;
  }
  for (const v of OUTCOME_VARS) acc[v] /= Math.max(1, list.length);
  return acc;
}

function l2(a: Record<CoreVar, number>, b: Record<CoreVar, number>): number {
  let s = 0;
  for (const v of OUTCOME_VARS) {
    const d = (a[v] ?? 0) - (b[v] ?? 0);
    s += d * d;
  }
  return Math.sqrt(s);
}

function runReplay(
  base: Record<string, AgentRuntime>,
  rounds: number,
  opts: { bypassCaps: boolean; bypassModulation: boolean },
  perturb?: { variable: CoreVar; delta: number },
): { runtime: Record<string, AgentRuntime>; capEverTriggered: { rep: boolean; opp: boolean } } {
  const rt = cloneRuntime(base);
  if (perturb) {
    for (const r of Object.values(rt)) {
      if (!r.core) r.core = defaultCore();
      const cur = (r.core[perturb.variable] as number) ?? 0;
      r.core[perturb.variable] = Math.max(0, Math.min(1, cur + perturb.delta)) as never;
    }
  }
  const capEverTriggered = { rep: false, opp: false };
  for (let i = 0; i < rounds; i++) {
    applyV5Round(rt, i, rounds, opts);
    for (const r of Object.values(rt)) {
      if (r.dampingDiagnostics?.reputationCapTriggered) capEverTriggered.rep = true;
      if (r.dampingDiagnostics?.opportunityCapTriggered) capEverTriggered.opp = true;
    }
  }
  return { runtime: rt, capEverTriggered };
}

// Network saturation proxy: mean of (reputation + opportunity_access) / 2.
function networkSaturation(rt: Record<string, AgentRuntime>): number {
  const list = Object.values(rt);
  if (list.length === 0) return 0;
  let s = 0;
  for (const r of list) {
    const c = r.core ?? defaultCore();
    s += ((c.reputation ?? 0) + (c.opportunity_access ?? 0)) / 2;
  }
  return s / list.length;
}

export function runSensitivityAnalysis(
  baseRuntime: Record<string, AgentRuntime>,
  rounds: number,
): SensitivitySummary {
  const r = Math.max(1, Math.min(rounds, 8));

  const baseDamped = runReplay(baseRuntime, r, { bypassCaps: false, bypassModulation: false });
  const basePreCap = runReplay(baseRuntime, r, { bypassCaps: true, bypassModulation: false });
  const baseRaw = runReplay(baseRuntime, r, { bypassCaps: true, bypassModulation: true });

  const baseDampedOut = meanCore(baseDamped.runtime);
  const basePreCapOut = meanCore(basePreCap.runtime);
  const baseRawOut = meanCore(baseRaw.runtime);

  const rows: SensitivityRow[] = [];
  for (const v of PERTURB_VARS) {
    const damped = runReplay(baseRuntime, r, { bypassCaps: false, bypassModulation: false }, { variable: v, delta: PERTURB_DELTA });
    const preCap = runReplay(baseRuntime, r, { bypassCaps: true, bypassModulation: false }, { variable: v, delta: PERTURB_DELTA });
    const raw    = runReplay(baseRuntime, r, { bypassCaps: true, bypassModulation: true  }, { variable: v, delta: PERTURB_DELTA });

    const S_damped  = l2(meanCore(damped.runtime),  baseDampedOut);
    const S_pre_cap = l2(meanCore(preCap.runtime),  basePreCapOut);
    const S_raw     = l2(meanCore(raw.runtime),     baseRawOut);

    const ratio = S_pre_cap / (S_damped + EPS);
    const capTriggered =
      damped.capEverTriggered.rep || damped.capEverTriggered.opp ||
      preCap.capEverTriggered.rep || preCap.capEverTriggered.opp;
    const saturation = networkSaturation(damped.runtime);

    let classification: ConstraintLabel = "unconstrained";
    if (ratio > 5) {
      if (capTriggered) classification = "cap-limited";
      else if (saturation > 0.5) classification = "network-limited";
      else classification = "modulation-limited";
    }

    rows.push({
      variable: v,
      S_pre_cap: +S_pre_cap.toFixed(4),
      S_raw: +S_raw.toFixed(4),
      S_damped: +S_damped.toFixed(4),
      ratio_pre_to_damped: +ratio.toFixed(3),
      classification,
      highValueSuppressed: ratio > 5,
      capTriggered,
      saturation: +saturation.toFixed(3),
    });
  }

  const damping_attenuation_factor = rows.length
    ? rows.reduce((a, x) => a + x.S_raw / (x.S_damped + EPS), 0) / rows.length
    : 0;
  const damping_ratio = rows.length
    ? rows.reduce((a, x) => a + Math.abs(x.S_damped), 0) / rows.length
    : 0;
  const max_sensitivity_loss = rows.length
    ? Math.max(...rows.map((x) => x.S_pre_cap / (x.S_damped + EPS)))
    : 0;

  return {
    rows,
    damping_attenuation_factor: +damping_attenuation_factor.toFixed(3),
    damping_ratio: +damping_ratio.toFixed(3),
    max_sensitivity_loss: +max_sensitivity_loss.toFixed(3),
    overDamped: damping_ratio < 0.5,
    suppressedVars: rows.filter((x) => x.highValueSuppressed).map((x) => x.variable),
    rounds: r,
  };
}
