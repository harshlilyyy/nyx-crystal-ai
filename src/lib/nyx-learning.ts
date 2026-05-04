// v6.4 — Constrained persistent learning store
// Saves a tiny summary of past advanced simulations to localStorage and
// derives a one-paragraph insight to inject into agent prompts.
import type { LearningSummary, Simulation, AgentRuntime, Report } from "./nyx-types";

const KEY = "nyx.learning.v1";
const MAX = 30;

function safe<T>(s: string | null, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

export function listLearning(): LearningSummary[] {
  if (typeof window === "undefined") return [];
  return safe<LearningSummary[]>(localStorage.getItem(KEY), []);
}

export function resetLearning(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}

const STOPWORDS = new Set([
  "the","a","an","and","or","but","of","to","in","on","for","with","at","by",
  "is","are","was","were","be","been","being","this","that","these","those",
  "it","its","as","from","into","about","over","under","than","then","so",
  "if","when","where","what","why","how","do","does","did","not","no","yes",
  "i","you","he","she","we","they","them","my","your","our","their","me",
  "will","would","could","should","can","may","might","just","very","more",
  "most","some","any","all","one","two","three"
]);

export function extractKeywords(text: string, max = 5): string[] {
  const tokens = (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}

// Top 3 dominant variables across final runtime (by stdev-like spread)
export function topDominantVars(runtime?: Record<string, AgentRuntime>): string[] {
  if (!runtime) return [];
  const all = Object.values(runtime);
  if (all.length === 0) return [];
  const keys = ["self_worth","anxiety","consistency","momentum","reputation","fragility_index","opportunity_access","lock_in","energy"] as const;
  const scores: { k: string; s: number }[] = [];
  for (const k of keys) {
    const vals = all.map((r) => r.core?.[k] ?? 0);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    // weight high-mean OR high-variance variables
    scores.push({ k, s: Math.abs(mean - 0.5) + Math.sqrt(variance) });
  }
  return scores.sort((a, b) => b.s - a.s).slice(0, 3).map((x) => x.k);
}

export function dominantOutcome(runtime?: Record<string, AgentRuntime>): LearningSummary["outcome"] {
  if (!runtime) return "steady";
  const counts: Record<string, number> = {};
  for (const r of Object.values(runtime)) {
    const m = r.modeV5 ?? "steady";
    counts[m] = (counts[m] ?? 0) + 1;
  }
  let best: LearningSummary["outcome"] = "steady"; let max = -1;
  for (const [k, v] of Object.entries(counts)) {
    if (v > max) { max = v; best = k as LearningSummary["outcome"]; }
  }
  return best;
}

export function recordLearning(sim: Simulation, report: Report): LearningSummary | undefined {
  if (typeof window === "undefined" || !sim.advanced) return;
  const summary: LearningSummary = {
    id: sim.id,
    ts: Date.now(),
    keywords: extractKeywords(sim.seed),
    topVars: topDominantVars(sim.runtime),
    outcome: dominantOutcome(sim.runtime),
    confidence: report.confidence,
    prngSeed: sim.prngSeed,
  };
  const all = [summary, ...listLearning().filter((l) => l.id !== sim.id)].slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(all));
  return summary;
}

// Pick relevant past runs (keyword overlap > 1), recent runs counted twice.
export function deriveInsight(seed: string): string | undefined {
  const kws = new Set(extractKeywords(seed));
  if (kws.size === 0) return;
  const all = listLearning();
  if (all.length === 0) return;
  const sortedRecent = [...all].sort((a, b) => b.ts - a.ts);
  const recentSet = new Set(sortedRecent.slice(0, Math.ceil(all.length / 2)).map((l) => l.id));

  type Hit = { l: LearningSummary; w: number };
  const hits: Hit[] = [];
  for (const l of all) {
    const overlap = l.keywords.filter((k) => kws.has(k)).length;
    if (overlap > 1) hits.push({ l, w: overlap * (recentSet.has(l.id) ? 2 : 1) });
  }
  if (hits.length === 0) return;
  hits.sort((a, b) => b.w - a.w);

  // Weighted outcome distribution
  const totalW = hits.reduce((a, h) => a + h.w, 0);
  const outcomeW: Record<string, number> = {};
  const varW: Record<string, number> = {};
  for (const { l, w } of hits) {
    outcomeW[l.outcome] = (outcomeW[l.outcome] ?? 0) + w;
    for (const v of l.topVars) varW[v] = (varW[v] ?? 0) + w;
  }
  const topOutcome = Object.entries(outcomeW).sort((a, b) => b[1] - a[1])[0];
  const topVars = Object.entries(varW).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
  const pct = Math.round((topOutcome[1] / totalW) * 100);
  const varsStr = topVars.length ? topVars.join(" + ") : "anxiety + low consistency";
  return `In ${hits.length} similar past simulation${hits.length > 1 ? "s" : ""}, high ${varsStr} led to "${topOutcome[0]}" outcomes in ${pct}% of cases. Consider this when forming your arguments.`;
}
