// v6.7 — Institutional reasoning layer (prompt-level role remap, no persistent state)

export type SwarmMode =
  | "debate"
  | "council"
  | "devils_advocate"
  | "exploration"
  | "rapid_fire"
  | "institutional";

export const SWARM_MODE_LABELS: Record<SwarmMode, string> = {
  debate: "Debate",
  council: "Council",
  devils_advocate: "Devil's Advocate",
  exploration: "Exploration",
  rapid_fire: "Rapid Fire",
  institutional: "Institutional",
};

export type InstitutionalFramework =
  | "courtroom"
  | "policy_panel"
  | "pre_mortem"
  | "grant_panel"
  | "intelligence_analysis";

export const FRAMEWORK_LABELS: Record<InstitutionalFramework, string> = {
  courtroom: "Courtroom",
  policy_panel: "Policy Panel",
  pre_mortem: "Pre-Mortem",
  grant_panel: "Grant Panel",
  intelligence_analysis: "Intelligence Analysis",
};

export const FRAMEWORK_PROTOCOLS: Record<InstitutionalFramework, { protocol: string; roles: string[] }> = {
  courtroom: {
    protocol: "Opening Statements → Cross-Examination → Deliberation → Verdict",
    roles: ["Prosecutor", "Defense", "Juror", "Juror", "Juror", "Judge"],
  },
  policy_panel: {
    protocol: "Impact Assessment → Stakeholder Review → Amendment → Vote",
    roles: ["Policy Advocate", "Fiscal Analyst", "Social Impact Assessor", "Legal Reviewer", "Chair"],
  },
  pre_mortem: {
    protocol: "Premise Acceptance → Failure Generation → Probability Ranking → Mitigation Mapping",
    roles: ["Pessimist (Operations)", "Pessimist (Market)", "Pessimist (Technical)", "Pessimist (People)", "Pessimist (Legal)", "Facilitator"],
  },
  grant_panel: {
    protocol: "Individual Scoring → Comparative Review → Budget Allocation → Final Ranking",
    roles: ["Domain Specialist A", "Domain Specialist B", "Domain Specialist C", "Budget Analyst", "Chair"],
  },
  intelligence_analysis: {
    protocol: "Hypothesis Generation → Evidence Mapping → Competing Analysis → Director's Brief",
    roles: ["Hypothesis Analyst H1", "Hypothesis Analyst H2", "Hypothesis Analyst H3", "Evidence Reviewer", "Director"],
  },
};

const KEYWORDS: Record<InstitutionalFramework, string[]> = {
  courtroom: ["lawsuit", "verdict", "guilty", "trial", "criminal", "court", "accuse", "evidence", "should we", "binary", "yes or no"],
  policy_panel: ["policy", "regulation", "law", "legislat", "tax", "government", "public", "reform", "ban", "subsidy"],
  pre_mortem: ["plan", "launch", "rollout", "what could go wrong", "fail", "risk", "before we", "proposal"],
  grant_panel: ["budget", "fund", "allocat", "grant", "invest", "resource", "scarce", "prioriti", "limited"],
  intelligence_analysis: ["unknown", "uncertain", "diagnos", "intelligence", "espionage", "threat", "what is happening", "hypothes"],
};

export function autoDetectFramework(seed: string): InstitutionalFramework {
  const s = (seed || "").toLowerCase();
  let best: InstitutionalFramework = "policy_panel";
  let bestScore = -1;
  for (const fw of Object.keys(KEYWORDS) as InstitutionalFramework[]) {
    const score = KEYWORDS[fw].reduce((acc, k) => acc + (s.includes(k) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = fw; }
  }
  return best;
}

export function frameworkWeights(fw?: InstitutionalFramework | null) {
  // STRUCTURAL_FEASIBILITY, STAKEHOLDER_ALIGNMENT, RISK_EXPOSURE, EVIDENCE_STRENGTH
  switch (fw) {
    case "courtroom":     return { sf: 0.225, sa: 0.20, re: 0.175, es: 0.40 };
    case "policy_panel":  return { sf: 0.275, sa: 0.35, re: 0.125, es: 0.25 };
    case "pre_mortem":    return { sf: 0.225, sa: 0.175, re: 0.40, es: 0.20 };
    case "grant_panel":   return { sf: 0.30, sa: 0.25, re: 0.15, es: 0.30 };
    case "intelligence_analysis": return { sf: 0.20, sa: 0.20, re: 0.20, es: 0.40 };
    default:              return { sf: 0.30, sa: 0.25, re: 0.15, es: 0.30 };
  }
}

export interface ConfidenceBreakdown {
  structuralFeasibility: number; // 0-10
  stakeholderAlignment: number;  // 0-10
  riskExposure: number;          // 0-10 (10 = safe)
  evidenceStrength: number;      // 0-10
  justifications?: {
    structuralFeasibility?: string;
    stakeholderAlignment?: string;
    riskExposure?: string;
    evidenceStrength?: string;
  };
  framework?: InstitutionalFramework | null;
}

export function computeConfidence(b: ConfidenceBreakdown): number {
  const w = frameworkWeights(b.framework);
  const raw =
    (b.structuralFeasibility ?? 0) * w.sf +
    (b.stakeholderAlignment ?? 0) * w.sa +
    (b.riskExposure ?? 0) * w.re +
    (b.evidenceStrength ?? 0) * w.es;
  return Math.max(0, Math.min(1, raw / 10));
}

export const CONFIDENCE_DIMENSIONS: { key: keyof ConfidenceBreakdown; label: string; short: string }[] = [
  { key: "structuralFeasibility", label: "Structural Feasibility", short: "Feasibility" },
  { key: "stakeholderAlignment", label: "Stakeholder Alignment", short: "Alignment" },
  { key: "riskExposure", label: "Risk Exposure (safe)", short: "Risk (safe)" },
  { key: "evidenceStrength", label: "Evidence Strength", short: "Evidence" },
];
