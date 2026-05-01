// Nyx Advanced Causal Modeling
// Pure deterministic helpers for agent state, transitions, thresholds,
// narratives, strategy modes, opportunity surfaces, and random events.

import type {
  AgentState,
  AgentRuntime,
  AgentTraits,
  StrategyMode,
  FeedItem,
  Round,
  LoopAnalysis,
  OpportunityCard,
  ActiveLoop,
  CausalChainEntry,
  MicroFailure,
} from "./nyx-types";
import { NYX_AGENTS } from "./nyx-agents";

const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const clamp100 = (v: number) => Math.max(0, Math.min(100, v));
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export function defaultState(): AgentState {
  const skill = rand(0.4, 0.7);
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
    skill_level: skill,
    networking: rand(0.3, 0.6),
    // v4
    actual_skill: skill,
    perceived_skill: skill * rand(0.85, 1.05),
    signal_strength: rand(0.3, 0.6),
    reputation: rand(0.2, 0.5),
    opportunity_access: rand(0.4, 0.7),
    peer_pressure: rand(0.2, 0.4),
    peer_gap: 0,
    parent_pressure: rand(0.3, 0.5),
    planning_execution_gap: rand(0.2, 0.5),
    skill_depth: rand(0.2, 0.5),
    inactionStreak: 0,
    noProgressStreak: 0,
  };
}

export function defaultTraits(id: string): AgentTraits {
  // Deterministic-ish per id with personality bias
  const bias: Record<string, Partial<AgentTraits>> = {
    harsh: { risk_tolerance: 0.8, execution_bias: 0.75, social_resilience: 0.7 },
    jayant: { execution_bias: 0.35, learning_rate: 0.7 },     // planner
    nova: { execution_bias: 0.4, risk_tolerance: 0.7 },        // forecaster, planner-ish
    orion: { execution_bias: 0.3, learning_rate: 0.8 },        // futurist, planner
    sage: { execution_bias: 0.4, learning_rate: 0.75 },        // philosopher, planner
    arc: { execution_bias: 0.85, social_resilience: 0.8, learning_rate: 0.7 },
    vera: { execution_bias: 0.7, social_resilience: 0.7 },
    ren: { execution_bias: 0.9 },
    sol: { social_resilience: 0.85, risk_tolerance: 0.6 },
    wren: { risk_tolerance: 0.9 },
  };
  const base: AgentTraits = {
    risk_tolerance: rand(0.3, 0.7),
    learning_rate: rand(0.4, 0.7),
    social_resilience: rand(0.4, 0.7),
    execution_bias: rand(0.4, 0.7),
  };
  return { ...base, ...(bias[id] ?? {}) };
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

// ---------- Thresholds & Mode ----------
export function deriveMode(s: AgentState): StrategyMode {
  if (s.parent_trust < -0.5 || s.support < -0.5) return "support_collapse";
  if (s.anxiety > 0.7 || s.self_worth < -0.3) return "avoidance";
  if (s.self_worth < 0.2 && s.effort > 0.4) return "recovery";
  if (s.skill_level > 0.8 && s.networking > 0.7) return "optimization";
  if (s.energy > 60 && s.effort > 0.6 && s.consistency > 0.5) return "optimization";
  if (s.self_worth > 0.7 && s.intrinsic_motivation > 0.6) return "exploration";
  return "exploration";
}

// Identity engine — self-narrative driven by self_worth bands.
export function deriveNarrative(s: AgentState, prev: string): string {
  if (s.parent_trust < -0.5) return "I have lost the room.";
  if (s.self_worth < 0.25) return "I am a failure.";
  if (s.self_worth < 0.55) return "I am recovering.";
  if (s.self_worth < 0.75) return "I am improving.";
  if (s.self_worth >= 0.75) return "I am capable.";
  if (s.anxiety > 0.7) return "I am overwhelmed.";
  if (s.isolation > 0.6) return "I am alone in this.";
  return prev || "I am present.";
}

// ---------- Decision logic under bias ----------
export function actionBias(rt: AgentRuntime): { preferred: string[]; suppressed: string[] } {
  const s = rt.state;
  const preferred: string[] = [];
  const suppressed: string[] = [];

  if (s.anxiety > 0.7 || s.self_worth < 0.3) {
    preferred.push("IDLE", "MUTE", "WITHDRAW");
    suppressed.push("POST");
  }
  if (s.intrinsic_motivation > 0.6 && s.self_worth > 0.5) {
    preferred.push("POST", "COMMENT");
  }
  if (s.burnout > 70) {
    preferred.push("IDLE");
    suppressed.push("POST", "COMMENT");
  }
  if (s.skill_level > 0.7 && s.networking > 0.5) {
    preferred.push("SEEK_OPPORTUNITY");
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
    energy: Math.round(s.energy),
    intrinsic_motivation: r(s.intrinsic_motivation),
    burnout: Math.round(s.burnout),
    skill_level: r(s.skill_level),
    networking: r(s.networking),
  };
}

// ---------- Regression events (every 3 rounds, one random agent) ----------
export function rollRegressionEvent(
  runtime: Record<string, AgentRuntime>,
  roundIndex: number
): { agentId: string; kind: string; description: string } | null {
  if ((roundIndex + 1) % 3 !== 0) return null;
  const ids = Object.keys(runtime);
  if (ids.length === 0) return null;
  const id = ids[Math.floor(Math.random() * ids.length)];
  const rt = runtime[id];
  const s = rt.state;
  const a = NYX_AGENTS.find((x) => x.id === id);
  const name = a?.name ?? id;

  if (s.energy < 30) {
    s.anxiety = clamp01(s.anxiety + 0.1);
    s.consistency = clamp01(s.consistency - 0.05);
    return { agentId: id, kind: "burnout", description: `${name} hit burnout — energy depleted, anxiety spikes.` };
  }
  if (s.isolation > 0.6) {
    s.self_worth = clamp(s.self_worth - 0.05);
    return { agentId: id, kind: "negative_event", description: `${name} suffers a negative event in isolation — self-worth slips.` };
  }
  if (s.parent_trust < -0.4) {
    s.support = clamp(s.support - 0.1);
    return { agentId: id, kind: "support_collapse", description: `${name} loses key support — the room turns colder.` };
  }
  s.energy = clamp100(s.energy - 8);
  return { agentId: id, kind: "setback", description: `${name} faces a setback — momentum stalls.` };
}

// ---------- Opportunity generation ----------
export function rollOpportunities(
  runtime: Record<string, AgentRuntime>,
  roundIndex: number
): { agentId: string; card: OpportunityCard }[] {
  const out: { agentId: string; card: OpportunityCard }[] = [];
  for (const rt of Object.values(runtime)) {
    const s = rt.state;
    const p = s.skill_level * 0.5 + s.networking * 0.3;
    if (Math.random() < p && s.skill_level > 0.6) {
      const a = NYX_AGENTS.find((x) => x.id === rt.agentId);
      const kinds: OpportunityCard["kind"][] = ["mentor", "internship", "partnership", "audience", "collab"];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      const descMap: Record<OpportunityCard["kind"], string> = {
        mentor: `A mentor reaches out to ${a?.name ?? rt.agentId} with a clear next step.`,
        internship: `${a?.name ?? rt.agentId} is offered a focused trial role.`,
        partnership: `${a?.name ?? rt.agentId} is invited into a partnership.`,
        audience: `${a?.name ?? rt.agentId}'s signal lands with a new audience.`,
        collab: `${a?.name ?? rt.agentId} is pulled into a collaboration.`,
      };
      const card: OpportunityCard = {
        id: `opp_${roundIndex}_${rt.agentId}_${Math.random().toString(36).slice(2, 6)}`,
        kind,
        description: descMap[kind],
        round: roundIndex,
      };
      rt.opportunityCards = [...(rt.opportunityCards ?? []), card];
      rt.state.intrinsic_motivation = clamp01(rt.state.intrinsic_motivation + 0.05);
      rt.state.support = clamp(rt.state.support + 0.04);
      out.push({ agentId: rt.agentId, card });
    }
  }
  return out;
}

// ---------- Active loops (recent rounds window) ----------
export function deriveActiveLoops(rounds: Round[], windowSize = 3): ActiveLoop[] {
  const recent = rounds.slice(-windowSize);
  const tally: Record<string, { fail: number; succ: number; rounds: number[] }> = {};
  for (const r of recent) {
    for (const item of r.feed) {
      const t = tally[item.agentId] ?? { fail: 0, succ: 0, rounds: [] };
      const isFail = item.action === "IDLE" || item.action === "MUTE" || item.action === "WITHDRAW";
      if (isFail) t.fail += 1; else t.succ += 1;
      if (!t.rounds.includes(r.index)) t.rounds.push(r.index);
      tally[item.agentId] = t;
    }
  }
  const loops: ActiveLoop[] = [];
  for (const [id, t] of Object.entries(tally)) {
    const a = NYX_AGENTS.find((x) => x.id === id);
    if (t.fail >= 2 && t.fail > t.succ) {
      loops.push({
        agentId: id,
        kind: "negative",
        rounds: t.rounds,
        description: `${a?.name ?? id} is in a withdrawal loop — confidence eroding, avoidance growing.`,
      });
    } else if (t.succ >= 3 && t.succ > t.fail * 2) {
      loops.push({
        agentId: id,
        kind: "positive",
        rounds: t.rounds,
        description: `${a?.name ?? id} is in a momentum loop — engagement compounds confidence.`,
      });
    }
  }
  return loops;
}

// ---------- Conditional outcome assessment (heuristic) ----------
export function trajectoryProbability(s: AgentState): number {
  let p = 50;
  p += (s.parent_trust + s.support) * 15;
  p += (s.self_worth - 0.5) * 30;
  p += (s.consistency - 0.5) * 20;
  p -= (s.anxiety - 0.5) * 25;
  p -= (s.isolation - 0.5) * 15;
  p += (s.intrinsic_motivation - 0.5) * 10;
  p -= (s.burnout - 50) * 0.2;
  return Math.max(0, Math.min(100, Math.round(p)));
}
