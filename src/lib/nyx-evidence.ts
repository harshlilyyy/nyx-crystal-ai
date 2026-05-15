// EvidenceValidator — compares an LLM-generated agent claim against the
// deterministic kernel-computed core-state delta for that round. Flags claims
// whose direction (rising / falling / high / low) contradicts the measured
// trajectory. Never overrides — only annotates for human review.
import type { CoreState, CoreVar } from "./nyx-types";

export interface EvidenceFlag {
  grounded: boolean;
  variable?: CoreVar;
  reason?: string;
  measuredDelta?: number;
}

interface Pattern {
  re: RegExp;
  variable: CoreVar;
  expectedSign: 1 | -1; // 1 = claim says rising, -1 = falling
}

// Phrase → (variable, expected delta sign)
const PATTERNS: Pattern[] = [
  { re: /\btrust\b.*\b(rising|growing|increas|up|higher|stronger|building)/i, variable: "reputation", expectedSign: 1 },
  { re: /\btrust\b.*\b(falling|declin|decreas|down|lower|weaker|eroding|crumbl)/i, variable: "reputation", expectedSign: -1 },
  { re: /\b(reputation|standing)\b.*\b(rising|growing|up|stronger|recovering)/i, variable: "reputation", expectedSign: 1 },
  { re: /\b(reputation|standing)\b.*\b(falling|declin|down|weaker|damaged)/i, variable: "reputation", expectedSign: -1 },
  { re: /\banxiety\b.*\b(rising|growing|increas|up|higher|spiking)/i, variable: "anxiety", expectedSign: 1 },
  { re: /\banxiety\b.*\b(falling|declin|decreas|down|lower|easing|calming)/i, variable: "anxiety", expectedSign: -1 },
  { re: /\b(self[- ]worth|confidence)\b.*\b(rising|growing|up|stronger|recovering)/i, variable: "self_worth", expectedSign: 1 },
  { re: /\b(self[- ]worth|confidence)\b.*\b(falling|declin|down|weaker|crumbl|collaps)/i, variable: "self_worth", expectedSign: -1 },
  { re: /\bmomentum\b.*\b(rising|growing|building|up|stronger|gaining)/i, variable: "momentum", expectedSign: 1 },
  { re: /\bmomentum\b.*\b(falling|stalling|losing|down|weaker|fading)/i, variable: "momentum", expectedSign: -1 },
  { re: /\b(consistency)\b.*\b(rising|improving|up|stronger)/i, variable: "consistency", expectedSign: 1 },
  { re: /\b(consistency)\b.*\b(falling|breaking|down|weaker|inconsistent)/i, variable: "consistency", expectedSign: -1 },
  { re: /\b(opportunity|opportunities|access)\b.*\b(rising|opening|expand|growing|up)/i, variable: "opportunity_access", expectedSign: 1 },
  { re: /\b(opportunity|opportunities|access)\b.*\b(closing|shrink|down|narrowing|drying)/i, variable: "opportunity_access", expectedSign: -1 },
  { re: /\b(fragil|brittl)/i, variable: "fragility_index", expectedSign: 1 },
  { re: /\b(stable|stabilizing|robust|resilient)/i, variable: "fragility_index", expectedSign: -1 },
  { re: /\benergy\b.*\b(rising|recovering|up|fresh|charged)/i, variable: "energy", expectedSign: 1 },
  { re: /\b(burnout|exhaust|drain|depleted|depleting)/i, variable: "energy", expectedSign: -1 },
];

const EPSILON = 0.005; // delta below this is "flat" → cannot contradict

export function validateClaim(
  claim: string,
  prev: CoreState | undefined,
  curr: CoreState | undefined,
): EvidenceFlag {
  if (!claim || !prev || !curr) return { grounded: true };
  for (const p of PATTERNS) {
    if (!p.re.test(claim)) continue;
    const delta = (curr[p.variable] ?? 0) - (prev[p.variable] ?? 0);
    if (Math.abs(delta) < EPSILON) {
      return {
        grounded: false,
        variable: p.variable,
        measuredDelta: delta,
        reason: `Claim implies ${p.expectedSign > 0 ? "increase" : "decrease"} in ${p.variable}, but kernel delta ≈ 0 (${delta.toFixed(3)}).`,
      };
    }
    const actualSign = delta > 0 ? 1 : -1;
    if (actualSign !== p.expectedSign) {
      return {
        grounded: false,
        variable: p.variable,
        measuredDelta: delta,
        reason: `Claim implies ${p.expectedSign > 0 ? "increase" : "decrease"} in ${p.variable}, but kernel measured ${delta > 0 ? "+" : ""}${delta.toFixed(3)}.`,
      };
    }
    return { grounded: true, variable: p.variable, measuredDelta: delta };
  }
  return { grounded: true };
}

export function groundingHint(flag: EvidenceFlag): string {
  if (flag.grounded || !flag.variable) return "";
  return `Your claim appears inconsistent with the simulation state for ${flag.variable}. Please ground your argument in the measured trajectory data provided below.`;
}
