// Nyx Advanced Causal Modeling
// Pure deterministic helpers for agent state, transitions, thresholds,
// narratives, strategy modes, opportunity surfaces, and random events.

import type {
  AgentState,
  AgentRuntime,
  StrategyMode,
  FeedItem,
  Round,
  LoopAnalysis,
  OpportunityCard,
  ActiveLoop,
} from "./nyx-types";
import { NYX_AGENTS } from "./nyx-agents";

const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const clamp100 = (v: number) => Math.max(0, Math.min(100, v));
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export function defaultState(): AgentState {
  return {
    delay_truth: rand(0.1, 0.4),
    parent_trust: rand(0.2, 0.5),
    support: rand(0.2, 0.5),
    consistency: rand(0.3, 0.6),
    self_worth: rand(0.3, 0.6),
    anxiety: rand(0.2, 0.5),
    effort: rand(0.4, 0.7),
    isolation: rand(0.1, 0.4),
    energy: rand(50, 80),
    intrinsic_motivation: rand(0.4, 0.7),
    burnout: rand(10, 30),
    skill_level: rand(0.4, 0.7),
    networking: rand(0.3, 0.6),
  };
}

// Slight personality-driven variation so agents don't all start identical.
function seedFromPersonality(id: string): Partial<AgentState> {
  const map: Record<string, Partial<AgentState>> = {
    harsh: { anxiety: 0.15, self_worth: 0.55, consistency: 0.6 },
    lyra: { parent_trust: 0.55, support: 0.55, anxiety: 0.25 },
    kai: { effort: 0.65, anxiety: 0.45 },
    sol: { self_worth: 0.6, energy: 0.75, isolation: 0.1 },
    noor: { consistency: 0.7, effort: 0.6 },
    iris: { anxiety: 0.5, support: 0.4 },
    wren: { effort: 0.4, isolation: 0.35 },
    vera: { consistency: 0.75, self_worth: 0.55 },
    arc: { consistency: 0.7, support: 0.5 },
  };
  return map[id] ?? {};
}

export function initRuntime(agentIds: string[]): Record<string, AgentRuntime> {
  const out: Record<string, AgentRuntime> = {};
  for (const id of agentIds) {
    const state = { ...defaultState(), ...seedFromPersonality(id) };
    out[id] = {
      agentId: id,
      state,
      mode: deriveMode(state),
      narrative: deriveNarrative(state, "I am beginning."),
      opportunities: ["voice", "challenge", "build", "support", "withdraw"],
      closed: [],
      consistencyStreak: 0,
      opportunityCards: [],
      trajectoryProbability: 50,
      history: [],
    };
  }
  return out;
}

// ---------- Transitions ----------
// Apply deterministic rules between rounds.
export function applyTransitions(rt: AgentRuntime): AgentRuntime {
  const s = { ...rt.state };
  let streak = rt.consistencyStreak ?? 0;

  // Track 4-round consistency streak → self_worth boost
  if (s.consistency > 0.6) {
    streak += 1;
    if (streak >= 4) s.self_worth = clamp(s.self_worth + 0.04);
  } else {
    streak = 0;
  }

  // Spec rules
  if (s.delay_truth > 0.5) s.parent_trust = clamp(s.parent_trust - 0.05);
  if (s.consistency > 0.6) s.self_worth = clamp(s.self_worth + 0.03);
  if (s.support > 0) s.anxiety = clamp01(s.anxiety - 0.03);
  if (s.self_worth < 0.2) s.support = clamp(s.support - 0.08);
  if (s.anxiety > 0.7) s.isolation = clamp01(s.isolation + 0.02);

  // Compounding effects
  if (s.isolation > 0.6) s.support = clamp(s.support - 0.04);
  if (s.support < 0) s.anxiety = clamp01(s.anxiety + 0.05);
  if (s.anxiety > 0.7) s.energy = clamp100(s.energy - 5);
  if (s.energy < 20) s.effort = clamp01(s.effort - 0.04);
  if (s.effort > 0.6 && s.consistency > 0.5) s.self_worth = clamp(s.self_worth + 0.02);
  if (s.parent_trust < -0.3) s.anxiety = clamp01(s.anxiety + 0.04);

  // Burnout dynamics
  if (s.effort > 0.7) s.burnout = clamp100(s.burnout + 4);
  if (s.energy > 60 && s.anxiety < 0.4) s.burnout = clamp100(s.burnout - 3);
  if (s.burnout > 70) {
    s.energy = clamp100(s.energy - 6);
    s.intrinsic_motivation = clamp01(s.intrinsic_motivation - 0.04);
  }

  // Skill / networking growth from sustained engagement
  const recent = rt.history.slice(-4);
  const successes = recent.filter((h) => h.outcome === "success").length;
  const failures = recent.filter((h) => h.outcome === "failure").length;
  if (successes >= 2) {
    s.skill_level = clamp01(s.skill_level + 0.02);
    s.networking = clamp01(s.networking + 0.02);
    s.intrinsic_motivation = clamp01(s.intrinsic_motivation + 0.03);
  }
  if (failures >= 2) {
    s.self_worth = clamp(s.self_worth - 0.06);
    s.isolation = clamp01(s.isolation + 0.05);
    s.intrinsic_motivation = clamp01(s.intrinsic_motivation - 0.03);
  }

  const mode = deriveMode(s);
  const narrative = deriveNarrative(s, rt.narrative);
  const { opportunities, closed } = updateOpportunities(rt, s, mode);

  return { ...rt, state: s, mode, narrative, opportunities, closed, consistencyStreak: streak };
}
  const s = { ...rt.state };

  // Core rules from spec
  if (s.delay_truth > 0.5) s.parent_trust = clamp(s.parent_trust - 0.05);
  if (s.consistency > 0.6) s.self_worth = clamp(s.self_worth + 0.03);

  // Compounding effects
  if (s.isolation > 0.6) s.support = clamp(s.support - 0.04);
  if (s.support < 0) s.anxiety = clamp(s.anxiety + 0.05);
  if (s.anxiety > 0.7) s.energy = clamp(s.energy - 0.05);
  if (s.energy < 0.2) s.effort = clamp(s.effort - 0.04);
  if (s.effort > 0.6 && s.consistency > 0.5) s.self_worth = clamp(s.self_worth + 0.02);
  if (s.parent_trust < -0.3) s.anxiety = clamp(s.anxiety + 0.04);

  // Recent action feedback
  const recent = rt.history.slice(-3);
  const failures = recent.filter((h) => h.outcome === "failure").length;
  const successes = recent.filter((h) => h.outcome === "success").length;
  if (failures >= 2) {
    s.self_worth = clamp(s.self_worth - 0.06);
    s.isolation = clamp(s.isolation + 0.05);
  }
  if (successes >= 2) {
    s.self_worth = clamp(s.self_worth + 0.05);
    s.support = clamp(s.support + 0.04);
  }

  const mode = deriveMode(s);
  const narrative = deriveNarrative(s, rt.narrative);
  const { opportunities, closed } = updateOpportunities(rt, s, mode);

  return { ...rt, state: s, mode, narrative, opportunities, closed };
}

// ---------- Thresholds & Mode ----------
export function deriveMode(s: AgentState): StrategyMode {
  if (s.parent_trust < -0.5 || s.support < -0.5) return "support_collapse";
  if (s.anxiety > 0.7 || s.self_worth < -0.3) return "avoidance";
  if (s.self_worth < 0.2 && s.effort > 0.4) return "recovery";
  if (s.energy > 0.6 && s.effort > 0.6 && s.consistency > 0.5) return "optimization";
  return "exploration";
}

export function deriveNarrative(s: AgentState, prev: string): string {
  if (s.parent_trust < -0.5) return "I have lost the room.";
  if (s.self_worth < -0.2) return "I am a failure.";
  if (s.self_worth < 0.2 && s.effort > 0.4) return "I am recovering.";
  if (s.self_worth > 0.5 && s.consistency > 0.5) return "I am improving.";
  if (s.anxiety > 0.7) return "I am overwhelmed.";
  if (s.isolation > 0.6) return "I am alone in this.";
  return prev || "I am present.";
}

// ---------- Decision logic under bias ----------
// Returns a weighted action preference the LLM should respect.
export function actionBias(rt: AgentRuntime): { preferred: string[]; suppressed: string[] } {
  const s = rt.state;
  const preferred: string[] = [];
  const suppressed: string[] = [];

  if (s.anxiety > 0.6 || s.self_worth < 0) {
    preferred.push("IDLE", "MUTE", "WITHDRAW");
    suppressed.push("POST");
  }
  if (rt.mode === "support_collapse") {
    preferred.push("WITHDRAW", "MUTE");
    suppressed.push("POST", "COMMENT", "REPOST");
  }
  if (rt.mode === "optimization") {
    preferred.push("POST", "COMMENT");
    suppressed.push("IDLE", "MUTE");
  }
  if (rt.mode === "avoidance") {
    preferred.push("LIKE", "IDLE");
    suppressed.push("POST");
  }
  if (rt.mode === "recovery") {
    preferred.push("COMMENT", "LIKE");
  }
  return { preferred, suppressed };
}

// ---------- Opportunity surface ----------
function updateOpportunities(
  rt: AgentRuntime,
  s: AgentState,
  mode: StrategyMode
): { opportunities: string[]; closed: string[] } {
  const opportunities = new Set(rt.opportunities);
  const closed = new Set(rt.closed);

  if (mode === "support_collapse") {
    ["voice", "build"].forEach((o) => { opportunities.delete(o); closed.add(o); });
  }
  if (s.isolation > 0.7) {
    ["support"].forEach((o) => { opportunities.delete(o); closed.add(o); });
  }
  if (s.energy > 0.6 && mode === "optimization") {
    ["scale", "lead"].forEach((o) => opportunities.add(o));
  }
  if (mode === "recovery" && s.self_worth > 0.3) {
    ["voice"].forEach((o) => { opportunities.add(o); closed.delete(o); });
  }
  return { opportunities: [...opportunities], closed: [...closed] };
}

// ---------- Random events ----------
export function rollRandomEvents(
  runtime: Record<string, AgentRuntime>,
  roundIndex: number
): { agentId: string; kind: string; description: string }[] {
  const events: { agentId: string; kind: string; description: string }[] = [];
  for (const rt of Object.values(runtime)) {
    const s = rt.state;
    // higher effort + lower isolation -> more positive shocks
    const positiveP = Math.max(0, Math.min(0.5, s.effort * 0.4 - s.isolation * 0.2));
    // higher isolation + higher anxiety -> more negative shocks
    const negativeP = Math.max(0, Math.min(0.5, s.isolation * 0.4 + s.anxiety * 0.2));

    const r = Math.random();
    if (r < positiveP) {
      const a = NYX_AGENTS.find((x) => x.id === rt.agentId);
      events.push({
        agentId: rt.agentId,
        kind: "mentor_comment",
        description: `A mentor signal reaches ${a?.name ?? rt.agentId} (round ${roundIndex + 1}).`,
      });
      rt.state.support = clamp(rt.state.support + 0.08);
      rt.state.self_worth = clamp(rt.state.self_worth + 0.05);
    } else if (r < positiveP + negativeP) {
      const a = NYX_AGENTS.find((x) => x.id === rt.agentId);
      events.push({
        agentId: rt.agentId,
        kind: "negative_news",
        description: `Negative news reaches ${a?.name ?? rt.agentId} (round ${roundIndex + 1}).`,
      });
      rt.state.anxiety = clamp(rt.state.anxiety + 0.07);
      rt.state.parent_trust = clamp(rt.state.parent_trust - 0.04);
    }
  }
  return events;
}

// ---------- Feedback after a round ----------
// Heuristic: classify each feed item as success/failure/neutral and
// update the corresponding agent's runtime + history.
export function applyRoundFeedback(
  runtime: Record<string, AgentRuntime>,
  feed: FeedItem[],
  roundIndex: number
): Record<string, AgentRuntime> {
  const next: Record<string, AgentRuntime> = { ...runtime };
  for (const item of feed) {
    const rt = next[item.agentId];
    if (!rt) continue;
    let outcome: "success" | "failure" | "neutral" = "neutral";
    const engagement = (item.likes ?? 0) + (item.replies ?? 0) * 1.5;

    if (item.action === "IDLE" || item.action === "MUTE" || item.action === "WITHDRAW") {
      outcome = "failure";
      rt.state.isolation = clamp(rt.state.isolation + 0.04);
      rt.state.effort = clamp(rt.state.effort - 0.02);
    } else if (engagement > 8) {
      outcome = "success";
      rt.state.support = clamp(rt.state.support + 0.05);
      rt.state.self_worth = clamp(rt.state.self_worth + 0.03);
      rt.state.consistency = clamp(rt.state.consistency + 0.02);
    } else if (engagement < 2 && item.action === "POST") {
      outcome = "failure";
      rt.state.self_worth = clamp(rt.state.self_worth - 0.03);
      rt.state.anxiety = clamp(rt.state.anxiety + 0.03);
    }

    rt.history = [
      ...rt.history,
      { round: roundIndex, action: item.action, outcome, note: item.content.slice(0, 80) },
    ].slice(-12);
  }
  // refresh derived fields
  for (const id of Object.keys(next)) {
    const rt = next[id];
    rt.mode = deriveMode(rt.state);
    rt.narrative = deriveNarrative(rt.state, rt.narrative);
  }
  return next;
}

// ---------- Loop analysis (post-sim) ----------
export function analyzeLoops(rounds: Round[]): LoopAnalysis {
  const loops: LoopAnalysis["loops"] = [];
  const tippingPoints: LoopAnalysis["tippingPoints"] = [];
  const compoundEffects: string[] = [];

  // Track per-agent failure/success streaks
  const streaks: Record<string, { kind: "success" | "failure" | null; count: number; rounds: number[] }> = {};

  for (const r of rounds) {
    for (const item of r.feed) {
      const id = item.agentId;
      const s = streaks[id] ?? { kind: null, count: 0, rounds: [] };
      const isFail =
        item.action === "IDLE" || item.action === "MUTE" || item.action === "WITHDRAW";
      const kind: "success" | "failure" = isFail ? "failure" : "success";
      if (s.kind === kind) {
        s.count += 1; s.rounds.push(r.index);
      } else {
        if (s.count >= 2 && s.kind) {
          const a = NYX_AGENTS.find((x) => x.id === id);
          loops.push({
            agentId: id,
            pattern: `${s.kind} chain × ${s.count}`,
            rounds: [...s.rounds],
            impact:
              s.kind === "failure"
                ? `${a?.name ?? id} compounded withdrawal — eroded support and self-worth.`
                : `${a?.name ?? id} compounded engagement — gained support and consistency.`,
          });
        }
        s.kind = kind; s.count = 1; s.rounds = [r.index];
      }
      streaks[id] = s;
    }

    // Tipping points from snapshot
    if (r.stateSnapshot) {
      for (const rt of Object.values(r.stateSnapshot)) {
        if (rt.mode === "support_collapse") {
          const a = NYX_AGENTS.find((x) => x.id === rt.agentId);
          tippingPoints.push({
            agentId: rt.agentId,
            threshold: `${a?.name ?? rt.agentId}: support_collapse triggered`,
            round: r.index,
          });
        }
      }
    }
  }

  // Flush remaining streaks
  for (const [id, s] of Object.entries(streaks)) {
    if (s.count >= 2 && s.kind) {
      const a = NYX_AGENTS.find((x) => x.id === id);
      loops.push({
        agentId: id,
        pattern: `${s.kind} chain × ${s.count}`,
        rounds: s.rounds,
        impact:
          s.kind === "failure"
            ? `${a?.name ?? id} ended in compounding withdrawal.`
            : `${a?.name ?? id} ended in compounding momentum.`,
      });
    }
  }

  if (loops.some((l) => l.pattern.startsWith("failure")) && loops.some((l) => l.pattern.startsWith("success"))) {
    compoundEffects.push("Polarization: some agents compounded gains while others compounded losses.");
  }
  if (tippingPoints.length > 0) {
    compoundEffects.push(`${tippingPoints.length} tipping point(s) crossed — system entered support_collapse for at least one agent.`);
  }

  return { loops, compoundEffects, tippingPoints };
}

// ---------- Prompt context ----------
export function runtimeForPrompt(runtime: Record<string, AgentRuntime>) {
  return Object.values(runtime).map((rt) => ({
    agentId: rt.agentId,
    state: roundState(rt.state),
    mode: rt.mode,
    narrative: rt.narrative,
    opportunities: rt.opportunities,
    closed: rt.closed,
    bias: actionBias(rt),
  }));
}

function roundState(s: AgentState): AgentState {
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    delay_truth: r(s.delay_truth),
    parent_trust: r(s.parent_trust),
    support: r(s.support),
    consistency: r(s.consistency),
    self_worth: r(s.self_worth),
    anxiety: r(s.anxiety),
    effort: r(s.effort),
    isolation: r(s.isolation),
    energy: r(s.energy),
  };
}
