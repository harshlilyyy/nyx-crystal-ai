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
      traits: defaultTraits(id),
      rank: 0,
      pathLocked: false,
      causalChain: [],
      microFailures: [],
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
    actual_skill: r(s.actual_skill),
    perceived_skill: r(s.perceived_skill),
    signal_strength: r(s.signal_strength),
    reputation: r(s.reputation),
    opportunity_access: r(s.opportunity_access),
    peer_pressure: r(s.peer_pressure),
    peer_gap: r(s.peer_gap),
    parent_pressure: r(s.parent_pressure),
    planning_execution_gap: r(s.planning_execution_gap),
    skill_depth: r(s.skill_depth),
    inactionStreak: s.inactionStreak,
    noProgressStreak: s.noProgressStreak,
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

// ============================================================
// v4 — Competitive & Signal Dynamics
// ============================================================

const SKILL_DEPTH_LOCK = 0.7;

// Composite "perceived success" score per agent (drives ranking).
export function successScore(rt: AgentRuntime): number {
  const s = rt.state;
  return (
    s.reputation * 0.35 +
    s.perceived_skill * 0.25 +
    s.opportunity_access * 0.15 +
    s.self_worth * 0.15 +
    s.networking * 0.10
  );
}

// Rank agents 1..N (1 = best). Mutates runtime.rank and returns ordered ids.
export function applyCompetitionRanking(
  runtime: Record<string, AgentRuntime>
): { agentId: string; score: number; rank: number }[] {
  const scored = Object.values(runtime).map((rt) => ({
    agentId: rt.agentId,
    score: successScore(rt),
    rank: 0,
  }));
  scored.sort((a, b) => b.score - a.score);
  scored.forEach((r, i) => {
    r.rank = i + 1;
    const rt = runtime[r.agentId];
    if (rt) rt.rank = r.rank;
  });

  // Comparison effect — laggards feel pressure
  const top = scored[0]?.score ?? 0;
  for (const r of scored) {
    const rt = runtime[r.agentId];
    if (!rt) continue;
    const gap = top - r.score;                 // 0 for leader
    rt.state.peer_gap = clamp(gap, -1, 1);
    if (gap > 0.05) {
      const resilience = rt.traits?.social_resilience ?? 0.5;
      const pressureGain = gap * (1 - resilience) * 0.5;
      rt.state.peer_pressure = clamp01(rt.state.peer_pressure + pressureGain);
      rt.state.self_worth = clamp(rt.state.self_worth - pressureGain * 0.4);
    } else {
      // leader bleeds pressure
      rt.state.peer_pressure = clamp01(rt.state.peer_pressure - 0.04);
    }
  }
  return scored;
}

// Action → outcome pipeline. Returns the causal chain entry and applies deltas.
export function processActionOutcome(
  rt: AgentRuntime,
  action: string,
  engagement: number,
  roundIndex: number
): CausalChainEntry {
  const t = rt.traits ?? { risk_tolerance: 0.5, learning_rate: 0.5, social_resilience: 0.5, execution_bias: 0.5 };
  const s = rt.state;

  const isExec = action === "POST" || action === "COMMENT" || action === "REPOST";
  const isIdle = action === "IDLE" || action === "MUTE" || action === "WITHDRAW";

  // Execution vs planning gap
  if (isIdle) s.planning_execution_gap = clamp01(s.planning_execution_gap + 0.04 * (1 - t.execution_bias));
  if (isExec) s.planning_execution_gap = clamp01(s.planning_execution_gap - 0.05 * t.execution_bias);

  // Skill gain (only real with execution; planning alone barely moves it)
  let skillGain = 0;
  if (isExec) {
    skillGain = t.learning_rate * 0.04 * (1 - s.actual_skill);
    s.actual_skill = clamp01(s.actual_skill + skillGain);
    s.skill_depth = clamp01(s.skill_depth + skillGain * 1.2);
  }

  // Signal strength rises with engagement; can be inflated without real skill (short-term)
  const signalDelta = isExec ? 0.03 + Math.min(0.1, engagement * 0.01) : -0.02;
  s.signal_strength = clamp01(s.signal_strength + signalDelta);

  // Perceived skill follows signal more than reality (short-term drift)
  const targetPerceived = 0.6 * s.signal_strength + 0.4 * s.actual_skill;
  s.perceived_skill = clamp01(s.perceived_skill * 0.7 + targetPerceived * 0.3);

  // Opportunity access — execution and networking grow it; idle shrinks it
  const oppDelta = isExec
    ? 0.03 + s.networking * 0.04
    : isIdle
      ? -0.05
      : 0;
  s.opportunity_access = clamp01(s.opportunity_access + oppDelta);

  // Reputation = slow accumulation of consistent visible action
  const repDelta = isExec ? Math.min(0.06, engagement * 0.005 + 0.01) : isIdle ? -0.03 : 0;
  s.reputation = clamp01(s.reputation + repDelta);

  // Inaction streak tracking
  if (isIdle) {
    s.inactionStreak = (s.inactionStreak ?? 0) + 1;
  } else {
    s.inactionStreak = 0;
  }

  // After 3 rounds inaction — sharper opportunity loss + anxiety
  if ((s.inactionStreak ?? 0) >= 3) {
    s.opportunity_access = clamp01(s.opportunity_access - 0.08);
    s.anxiety = clamp01(s.anxiety + 0.06);
    s.peer_gap = clamp(s.peer_gap + 0.05, -1, 1);
  }

  // No-progress streak (skill_depth growth tracker handled separately)
  if (skillGain < 0.001) {
    s.noProgressStreak = (s.noProgressStreak ?? 0) + 1;
  } else {
    s.noProgressStreak = 0;
  }

  // Path lock-in
  if (s.skill_depth >= SKILL_DEPTH_LOCK) rt.pathLocked = true;

  const entry: CausalChainEntry = {
    agentId: rt.agentId,
    round: roundIndex,
    action,
    skillGain: +skillGain.toFixed(3),
    signalDelta: +signalDelta.toFixed(3),
    opportunityDelta: +oppDelta.toFixed(3),
    reputationDelta: +repDelta.toFixed(3),
    note: isIdle ? "delay penalty applied" : isExec ? "action → skill → signal → opportunity" : "low-impact action",
  };
  rt.causalChain = [...(rt.causalChain ?? []), entry].slice(-20);
  return entry;
}

// Process all feed items through the v4 outcome pipeline.
export function processRoundOutcomes(
  runtime: Record<string, AgentRuntime>,
  feed: FeedItem[],
  roundIndex: number
): CausalChainEntry[] {
  const entries: CausalChainEntry[] = [];
  for (const item of feed) {
    const rt = runtime[item.agentId];
    if (!rt) continue;
    const engagement = (item.likes ?? 0) + (item.replies ?? 0) * 1.5;
    entries.push(processActionOutcome(rt, item.action, engagement, roundIndex));
  }
  return entries;
}

// Parent expectation dynamics — visible progress eases pressure; failure raises it.
export function updateParentExpectation(rt: AgentRuntime): void {
  const s = rt.state;
  const recent = rt.history.slice(-3);
  const successes = recent.filter((h) => h.outcome === "success").length;
  const failures = recent.filter((h) => h.outcome === "failure").length;
  if (failures >= 2) {
    s.parent_pressure = clamp01(s.parent_pressure + 0.08);
  } else if (successes >= 2) {
    s.parent_pressure = clamp01(s.parent_pressure - 0.06);
    s.parent_trust = clamp(s.parent_trust + 0.04);
  }
  // 3 rounds no progress → trust drops sharply
  if ((s.noProgressStreak ?? 0) >= 3) {
    s.parent_trust = clamp(s.parent_trust - 0.12);
    s.parent_pressure = clamp01(s.parent_pressure + 0.1);
  }
}

// Long-term reversal: if perceived >> actual for too long, signal collapses.
export function applySignalReversal(rt: AgentRuntime, roundIndex: number): MicroFailure | null {
  const s = rt.state;
  const gap = s.perceived_skill - s.actual_skill;
  if (gap > 0.25 && Math.random() < 0.35) {
    s.signal_strength = clamp01(s.signal_strength - 0.18);
    s.perceived_skill = clamp01(s.perceived_skill - 0.15);
    s.reputation = clamp01(s.reputation - 0.1);
    s.self_worth = clamp(s.self_worth - 0.08);
    const a = NYX_AGENTS.find((x) => x.id === rt.agentId);
    const mf: MicroFailure = {
      agentId: rt.agentId,
      kind: "bad_feedback",
      description: `${a?.name ?? rt.agentId} — signal exceeded substance; reputation correction.`,
      round: roundIndex,
    };
    rt.microFailures = [...(rt.microFailures ?? []), mf];
    return mf;
  }
  return null;
}

// Micro-failures (small disruptions). Probability rises with anxiety/inaction.
export function rollMicroFailures(
  runtime: Record<string, AgentRuntime>,
  roundIndex: number
): MicroFailure[] {
  const out: MicroFailure[] = [];
  const kinds: MicroFailure["kind"][] = ["rejected_application", "failed_interview", "bad_feedback", "missed_deadline"];
  for (const rt of Object.values(runtime)) {
    const s = rt.state;
    const p = Math.min(0.4, 0.05 + s.anxiety * 0.2 + (s.inactionStreak ?? 0) * 0.05);
    if (Math.random() < p) {
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      const a = NYX_AGENTS.find((x) => x.id === rt.agentId);
      const descMap: Record<MicroFailure["kind"], string> = {
        rejected_application: `${a?.name ?? rt.agentId} — application rejected.`,
        failed_interview: `${a?.name ?? rt.agentId} — interview did not land.`,
        bad_feedback: `${a?.name ?? rt.agentId} — received harsh feedback.`,
        missed_deadline: `${a?.name ?? rt.agentId} — missed a key deadline.`,
      };
      const mf: MicroFailure = { agentId: rt.agentId, kind, description: descMap[kind], round: roundIndex };
      // confidence dip + decision noise (anxiety up)
      s.self_worth = clamp(s.self_worth - 0.05);
      s.anxiety = clamp01(s.anxiety + 0.06);
      rt.microFailures = [...(rt.microFailures ?? []), mf];
      out.push(mf);
    }
    // Long-term reversal check
    const rev = applySignalReversal(rt, roundIndex);
    if (rev) out.push(rev);
    // Parent dynamics each round
    updateParentExpectation(rt);
  }
  return out;
}

// Network effects — when an agent gains a major opportunity, multipliers ripple.
export function applyNetworkMultiplier(
  runtime: Record<string, AgentRuntime>,
  agentId: string
): void {
  const lead = runtime[agentId];
  if (!lead) return;
  lead.state.opportunity_access = clamp01(lead.state.opportunity_access + 0.12);
  lead.state.networking = clamp01(lead.state.networking + 0.08);
  for (const rt of Object.values(runtime)) {
    if (rt.agentId === agentId) continue;
    // Peer agents get a small lift proportional to their networking
    const lift = 0.03 + rt.state.networking * 0.04;
    rt.state.opportunity_access = clamp01(rt.state.opportunity_access + lift);
  }
}

// Trajectory lock warning helper for UI
export function pathLockWarning(rt: AgentRuntime): string | null {
  if (rt.pathLocked) return `Path locked — ${rt.agentId} skill_depth ${rt.state.skill_depth.toFixed(2)}`;
  if (rt.state.skill_depth > 0.55) return `Lock-in approaching (${rt.state.skill_depth.toFixed(2)}/${SKILL_DEPTH_LOCK})`;
  return null;
}

// Planning vs execution heuristic for UI
export function planningExecutionHint(rt: AgentRuntime): string | null {
  const g = rt.state.planning_execution_gap;
  if (g > 0.65) return "High plan/exec gap — slow real progress.";
  if (g < 0.25) return "Tight execution — converting plans to action.";
  return null;
}

// ============================================================
// v5 — Seed-based core engine (10 vars, transitions, cascade)
// ============================================================
import type { CoreState, CoreVar, CustomVariable } from "./nyx-types";

const CORE_KEYS: CoreVar[] = [
  "self_worth", "anxiety", "consistency", "momentum", "reputation",
  "opportunity_access", "fragility_index", "lock_in", "learning_rate", "energy",
  "phenomenological_penetration",
];

export function isCoreVar(k: string): k is CoreVar {
  return (CORE_KEYS as string[]).includes(k);
}

export function defaultCore(): CoreState {
  return {
    self_worth: 0.5, anxiety: 0.3, consistency: 0.5, momentum: 0.5,
    reputation: 0.4, opportunity_access: 0.5, fragility_index: 0.3,
    lock_in: 0.2, learning_rate: 0.5, energy: 0.6,
    phenomenological_penetration: 0.5,
  };
}

export function normalizeCore(input: Partial<Record<CoreVar, number>>): CoreState {
  const c = defaultCore();
  for (const k of CORE_KEYS) {
    const v = input[k];
    if (typeof v === "number" && !Number.isNaN(v)) c[k] = clamp01(v);
  }
  return c;
}

export function validateCorePayload(raw: unknown): { ok: boolean; reason?: string } {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not object" };
  const obj = raw as Record<string, unknown>;
  if (Object.keys(obj).length === 0) return { ok: false, reason: "empty" };
  for (const [name, val] of Object.entries(obj)) {
    if (!val || typeof val !== "object") return { ok: false, reason: `${name}: not object` };
    const v = val as Record<string, unknown>;
    const core = (v.core ?? v.state ?? v) as Record<string, unknown>;
    for (const k of CORE_KEYS) {
      if (k === "phenomenological_penetration") continue; // optional from seed
      const n = core[k];
      if (typeof n !== "number" || Number.isNaN(n) || n < 0 || n > 1) {
        return { ok: false, reason: `${name}.${k} invalid (${n})` };
      }
    }
  }
  return { ok: true };
}

// Map AI extraction (keyed by agent name) onto runtime keyed by agentId.
// agentMap: { agentId -> agentName }. Falls back gracefully.
export function applyExtractedInit(
  runtime: Record<string, AgentRuntime>,
  extracted: Record<string, { core?: Partial<CoreState>; state?: Partial<CoreState>; custom?: CustomVariable[]; customVariables?: CustomVariable[]; emotionalAnchor?: { name: string; intensity: number; valence: number } }>,
  agentMap: Record<string, string>
): Record<string, AgentRuntime> {
  const lower = Object.fromEntries(
    Object.entries(extracted).map(([k, v]) => [k.toLowerCase().trim(), v])
  );
  const next = { ...runtime };
  for (const [agentId, name] of Object.entries(agentMap)) {
    const found = lower[name.toLowerCase().trim()];
    const rt = next[agentId];
    if (!rt) continue;
    if (!found) { rt.core = defaultCore(); continue; }
    const raw = (found.core ?? found.state ?? {}) as Partial<CoreState>;
    rt.core = normalizeCore(raw);
    const cv = (found.custom ?? found.customVariables ?? []).slice(0, 3).filter((c) =>
      c && typeof c.name === "string" && typeof c.value === "number" && isCoreVar(String(c.affects))
    ).map((c) => ({
      name: c.name,
      value: clamp01(c.value),
      min: typeof c.min === "number" ? c.min : 0,
      max: typeof c.max === "number" ? c.max : 1,
      affects: c.affects as CoreVar,
    }));
    rt.customVars = cv;
    rt.successStreak = 0;
    rt.failureStreak = 0;
    rt.cascade = false;
    rt.identity_conflict = 0;
    rt.timePressure = 0;
    rt.modeV5 = "steady";
    if (found.emotionalAnchor && typeof found.emotionalAnchor.name === "string") {
      const ea = found.emotionalAnchor;
      rt.emotionalAnchor = {
        name: ea.name,
        intensity: clamp01(ea.intensity ?? 0.5),
        valence: Math.max(-1, Math.min(1, ea.valence ?? 0)),
      };
    }
    rt.selfPerceptionBias = 0;
  }
  return next;
}

// Compute perceived peer_gap using the relevance-weighted existence layer.
function computePeerGap(
  rt: AgentRuntime,
  all: AgentRuntime[],
  avgExistenceValue: number,
  perceptionBias: number
): number {
  if (!rt.core) return 0;
  const meanVisibleReputation =
    all.reduce((sum, r) => sum + ((r.core?.reputation ?? 0) * 1.1), 0) / Math.max(1, all.length);
  const ownReputation = rt.core.reputation;
  const relevanceFactor = 1 + 0.5 * (1 - avgExistenceValue);
  const gap = (meanVisibleReputation - ownReputation) * perceptionBias * relevanceFactor;
  return clamp01(gap);
}

// Stochastic round outcome flags per agent.
function rollFlags(rt: AgentRuntime): {
  success_flag: number; failure_flag: number; signal_boost: number;
  social_feedback: number; mentor_flag: number; event_driven: number;
} {
  if (!rt.core) {
    return { success_flag: 0, failure_flag: 0, signal_boost: 0, social_feedback: 0, mentor_flag: 0, event_driven: 0 };
  }
  const c = rt.core;
  const pSuccess = clamp01(0.2 + 0.5 * c.consistency + 0.2 * c.opportunity_access);
  const pCollapse = clamp01(0.2 + 0.4 * c.anxiety + 0.2 * c.fragility_index);
  const success_flag = Math.random() < pSuccess ? 1 : 0;
  const failure_flag = Math.random() < pCollapse ? 1 : 0;
  const signal_boost = success_flag ? 0.3 + Math.random() * 0.4 : 0;
  const social_feedback = success_flag ? 0.2 + Math.random() * 0.3 : (failure_flag ? -0.15 : 0);
  // mentor handled separately in applyV5Round (deterministic on streak)
  const event_driven = clamp01((failure_flag ? 0.3 : 0) + Math.random() * 0.2);
  return { success_flag, failure_flag, signal_boost, social_feedback, mentor_flag: 0, event_driven };
}

// Apply one full round of v5 transitions. Returns events.
export function applyV5Round(
  runtime: Record<string, AgentRuntime>,
  roundIndex: number,
  totalRounds: number
): { agentId: string; kind: string; description: string }[] {
  const all = Object.values(runtime);
  const events: { agentId: string; kind: string; description: string }[] = [];
  const existenceMatrix = computeExistenceMatrix(runtime);

  // global time pressure (grows linearly toward 1.0 by final round)
  const tp = clamp01((roundIndex + 1) / Math.max(1, totalRounds));

  for (const rt of all) {
    if (!rt.core) rt.core = defaultCore();
    const c = { ...rt.core };
    const a = NYX_AGENTS.find((x) => x.id === rt.agentId);
    const name = a?.name ?? rt.agentId;
    rt.timePressure = tp;

    // Mentor event: deterministic if consistency > 0.7 for 3 consecutive rounds
    rt.consistencyStreak = c.consistency > 0.7 ? (rt.consistencyStreak ?? 0) + 1 : 0;
    const mentor_flag = (rt.consistencyStreak ?? 0) >= 3 ? 1 : 0;
    if (mentor_flag) {
      events.push({ agentId: rt.agentId, kind: "mentor", description: `${name} attracts a mentor — sustained consistency rewarded.` });
      rt.consistencyStreak = 0;
    }

    // Perception & event flags
    const existenceEdges = existenceMatrix.filter((edge) => edge.from === rt.agentId);
    const avgExistenceValue = existenceEdges.length
      ? existenceEdges.reduce((sum, edge) => sum + edge.existence_value, 0) / existenceEdges.length
      : 0.5;
    const perceptionBias = 1 + (rt.selfPerceptionBias ?? c.anxiety * 0.5);
    const peer_gap = computePeerGap(rt, all, avgExistenceValue, perceptionBias);
    const effectiveInfluence = existenceEdges.reduce((max, edge) => Math.max(max, edge.existence_value), 0);
    const flags = rollFlags(rt);

    // Streaks
    if (flags.success_flag) { rt.successStreak = (rt.successStreak ?? 0) + 1; rt.failureStreak = 0; }
    else if (flags.failure_flag) { rt.failureStreak = (rt.failureStreak ?? 0) + 1; rt.successStreak = 0; }

    const success_streak = rt.successStreak ?? 0;
    const failure_streak = rt.failureStreak ?? 0;

    // === Core state updates (per spec ordering) ===
    const progress = c.consistency * (0.6 + 0.4 * c.momentum);

    c.reputation = clamp01(c.reputation + 0.2 * progress + 0.1 * flags.signal_boost);

    c.opportunity_access = clamp01(
      c.opportunity_access + 0.25 * (c.consistency * c.reputation > 0.4 ? 1 : 0) + 0.15 * mentor_flag
    );

    c.self_worth = clamp01(
      c.self_worth + 0.25 * progress - 0.3 * Math.max(peer_gap, 0)
      + 0.15 * flags.social_feedback - 0.2 * flags.failure_flag
      + 0.1 * Math.max(effectiveInfluence, 0)
    );

    // Anxiety: context-sensitive + emotional inertia (v6.3)
    const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
    const context_modifier = sigmoid(c.self_worth - c.anxiety);
    const raw_anxiety_change =
      context_modifier * (0.4 * Math.max(peer_gap, 0) + 0.3 * flags.event_driven)
      - 0.2 * flags.success_flag;
    const raw_next = clamp01(c.anxiety + raw_anxiety_change);
    c.anxiety = clamp01(0.7 * c.anxiety + 0.3 * raw_next);

    // Momentum
    c.momentum = clamp01(
      c.momentum + 0.2 * success_streak - 0.25 * failure_streak - 0.1 * c.momentum * c.momentum
    );

    // Fragility / energy / lock-in / learning_rate / consistency drift
    c.fragility_index = clamp01(c.fragility_index + 0.05 * flags.failure_flag - 0.04 * flags.success_flag + 0.02 * tp);
    c.energy = clamp01(c.energy - 0.05 * tp - 0.04 * c.anxiety + 0.05 * flags.success_flag);
    c.lock_in = clamp01(c.lock_in + 0.04 * c.consistency * (1 - peer_gap));
    c.learning_rate = clamp01(c.learning_rate + 0.02 * flags.success_flag - 0.02 * flags.failure_flag);
    c.consistency = clamp01(c.consistency + 0.03 * c.momentum - 0.05 * flags.failure_flag - 0.03 * (rt.cascade ? 1 : 0));

    // Refined cascade trigger (v6.2): failure gated by perceived relevance.
    // Source of failure defaults to self → existence_value = 1.
    const effective_failure = flags.failure_flag * 1;
    // Cascade detection (failure_streak >= 3 AND self_worth < 0.4) OR effective_failure spike
    if ((failure_streak >= 3 && c.self_worth < 0.4) || effective_failure > 0.3) {
      rt.cascade = true;
      events.push({ agentId: rt.agentId, kind: "cascade", description: `${name} entered a failure cascade.` });
    }
    if (rt.cascade) {
      c.consistency = clamp01(c.consistency - 0.05);
      c.anxiety = clamp01(c.anxiety + 0.05);
    }

    // Recovery
    if (flags.success_flag || mentor_flag) {
      rt.failureStreak = 0;
      if (rt.cascade) events.push({ agentId: rt.agentId, kind: "recovery", description: `${name} broke the cascade.` });
      rt.cascade = false;
      c.momentum = clamp01(c.momentum + 0.3);
      c.self_worth = clamp01(c.self_worth + 0.15);
    }

    // Influence: small reputation contagion from leader
    const leaderRep = Math.max(...all.map((r) => r.core?.reputation ?? 0));
    if (leaderRep > c.reputation + 0.2) {
      c.reputation = clamp01(c.reputation + 0.02);
    }

    // Identity conflict: distance between current self_worth and reputation
    const id_conflict = Math.abs(c.self_worth - c.reputation);
    rt.identity_conflict = clamp01((rt.identity_conflict ?? 0) * 0.6 + id_conflict * 0.4);

    // Custom variable rules (each affects ONE core var, scaled mildly)
    if (rt.customVars) {
      for (const cv of rt.customVars) {
        const range = Math.max(1e-6, cv.max - cv.min);
        const norm = clamp01((cv.value - cv.min) / range);
        // signed nudge: above midpoint = +, below = -
        const nudge = (norm - 0.5) * 0.06;
        c[cv.affects] = clamp01(c[cv.affects] + nudge);
      }
    }

    // Emotional anchor — persistent attachment effects (v6.1)
    const prevSelfWorth = rt.core.self_worth;
    if (rt.emotionalAnchor) {
      const ea = rt.emotionalAnchor;
      c.self_worth = clamp01(c.self_worth + 0.05 * ea.intensity * ea.valence);
      c.anxiety = clamp01(c.anxiety + 0.05 * ea.intensity * Math.abs(ea.valence));
      // Closure trigger: significant positive shift in self_worth resets intensity
      if (c.self_worth - prevSelfWorth > 0.15) {
        ea.intensity = 1; // closure event "resets" (re-anchors at full)
        events.push({ agentId: rt.agentId, kind: "closure", description: `${name} reaches closure with ${ea.name}.` });
      } else {
        ea.intensity = clamp01(ea.intensity * 0.95);
      }
    }

    // Self-perception bias (v6.1) — distorted self-view under stress
    rt.selfPerceptionBias = c.anxiety * 0.5;
    const effective_self_worth = c.self_worth * (1 - rt.selfPerceptionBias);

    // Mode (v5/v6.3) — uses effective_self_worth (biased perception)
    // Conditional anxiety response: same anxiety, different behavior by self_worth.
    rt.modeV5 =
      c.fragility_index > 0.75 && effective_self_worth < 0.3 ? "collapse" :
      rt.cascade ? "fragile" :
      c.anxiety > 0.7 && c.self_worth > 0.6 ? "spike" :
      c.anxiety > 0.7 && c.self_worth < 0.4 ? "avoid" :
      effective_self_worth < 0.45 && c.momentum < 0.4 ? "recovery" :
      c.momentum > 0.65 && c.consistency > 0.55 ? "growth" : "steady";

    // Phenomenological penetration update (11th core var)
    c.phenomenological_penetration = clamp01(
      (c.phenomenological_penetration ?? 0.5) + 0.1 * c.anxiety - 0.05 * c.consistency
    );

    rt.core = c;
  }

  return events;
}

// Existence value matrix — directed pair influence weighting (v6.2 perceived relevance)
export interface ExistenceEdge {
  from: string; to: string;
  causal_proximity: number;
  scale_similarity: number;
  existence_value: number;
}

export function computeExistenceMatrix(runtime: Record<string, AgentRuntime>): ExistenceEdge[] {
  const ids = Object.keys(runtime);
  const edges: ExistenceEdge[] = [];
  for (const i of ids) {
    const ci = runtime[i].core;
    if (!ci) continue;
    for (const j of ids) {
      if (i === j) continue;
      const cj = runtime[j].core;
      if (!cj) continue;
      const causal_proximity = cj.opportunity_access;
      const scale_similarity = 1 - Math.abs(ci.opportunity_access - cj.opportunity_access);
      const existence_value =
        0.4 * causal_proximity +
        0.35 * scale_similarity +
        0.25 * (ci.phenomenological_penetration ?? 0.5);
      edges.push({ from: i, to: j, causal_proximity, scale_similarity, existence_value: clamp01(existence_value) });
    }
  }
  return edges;
}

// Local importance map — derived ranking of others by existence_value (v6.2)
export function localImportanceMap(
  agentId: string,
  runtime: Record<string, AgentRuntime>
): { id: string; existence_value: number }[] {
  const matrix = computeExistenceMatrix(runtime);
  return matrix
    .filter((e) => e.from === agentId)
    .map((e) => ({ id: e.to, existence_value: e.existence_value }))
    .sort((a, b) => b.existence_value - a.existence_value);
}

// Telemetry helpers for v5
export function v5Telemetry(rt: AgentRuntime, runtime?: Record<string, AgentRuntime>) {
  const c = rt.core ?? defaultCore();
  const importance = runtime ? localImportanceMap(rt.agentId, runtime) : [];
  return {
    momentum: c.momentum,
    cascade: !!rt.cascade,
    fragility: c.fragility_index,
    mode: rt.modeV5 ?? "steady",
    timePressure: rt.timePressure ?? 0,
    identityConflict: rt.identity_conflict ?? 0,
    customVars: rt.customVars ?? [],
    emotionalAnchor: rt.emotionalAnchor,
    selfPerceptionBias: rt.selfPerceptionBias ?? 0,
    phenomenologicalPenetration: c.phenomenological_penetration ?? 0.5,
    importanceMap: importance,
    topRelevant: importance.slice(0, 3),
  };
}


