export type AgentAction = "POST" | "COMMENT" | "LIKE" | "REPOST" | "IDLE" | "MUTE" | "WITHDRAW";

export interface Agent {
  id: string;
  name: string;
  role: string;
  avatar: string; // emoji
  personality: string;
  specialty: string;
  preset?: string[];
}

export interface OntologyNode {
  id: string;
  label: string;
  type: string;
  description: string;
}

export interface GraphNode {
  id: string;
  label: string;
  group: number;
}
export interface GraphEdge { source: string; target: string; weight: number; }

export interface FeedItem {
  id: string;
  agentId: string;
  agentName: string;
  agentAvatar: string;
  platform: "twitter" | "reddit";
  action: AgentAction;
  content: string;
  ts: number;
  likes?: number;
  replies?: number;
  // advanced
  isRandomEvent?: boolean;
  eventKind?: string;
}

// ====== Advanced causal modeling ======
export interface AgentState {
  delay_truth: number;
  parent_trust: number;
  support: number;
  consistency: number;
  self_worth: number;
  anxiety: number;
  effort: number;
  isolation: number;
  energy: number; // 0-100 scale
  // extended micro-simulation fields
  intrinsic_motivation: number;
  burnout: number; // 0-100 scale
  skill_level: number;
  networking: number;
  // v4 — competitive & signal dynamics
  actual_skill: number;        // 0-1 true ability
  perceived_skill: number;     // 0-1 signal/reputation
  signal_strength: number;     // 0-1 quality of broadcast
  reputation: number;          // 0-1 cumulative standing
  opportunity_access: number;  // 0-1 reachable opportunity bandwidth
  peer_pressure: number;       // 0-1 comparison stress
  peer_gap: number;            // -1..1 distance from leader
  parent_pressure: number;     // 0-1 family expectation load
  planning_execution_gap: number; // 0-1 (high = plans>>executes)
  skill_depth: number;         // 0-1 specialization depth (lock-in metric)
  inactionStreak?: number;
  noProgressStreak?: number;
}

// v4 — persistent agent traits
export interface AgentTraits {
  risk_tolerance: number;     // 0-1
  learning_rate: number;      // 0-1
  social_resilience: number;  // 0-1
  execution_bias: number;     // 0-1 (high = executor; low = planner)
}

// v4 — action→outcome causal chain entry (for telemetry visualization)
export interface CausalChainEntry {
  agentId: string;
  round: number;
  action: string;
  skillGain: number;
  signalDelta: number;
  opportunityDelta: number;
  reputationDelta: number;
  note: string;
}

// v4 — micro-failure events
export interface MicroFailure {
  agentId: string;
  kind: "rejected_application" | "failed_interview" | "bad_feedback" | "missed_deadline";
  description: string;
  round: number;
}

export interface OpportunityCard {
  id: string;
  kind: "mentor" | "internship" | "partnership" | "audience" | "collab";
  description: string;
  round: number;
}

export type StrategyMode = "avoidance" | "recovery" | "exploration" | "optimization" | "support_collapse";

// v5 — 10 core variables (all 0..1)
export interface CoreState {
  self_worth: number;
  anxiety: number;
  consistency: number;
  momentum: number;
  reputation: number;
  opportunity_access: number;
  fragility_index: number;
  lock_in: number;
  learning_rate: number;
  energy: number;
  phenomenological_penetration: number; // 11th — perceived relevance gating (0..1)
}

export type CoreVar = keyof CoreState;

export interface EmotionalAnchor {
  name: string;
  intensity: number; // 0..1
  valence: number;   // -1..1
}

export interface CustomVariable {
  name: string;
  value: number;
  min: number;
  max: number;
  affects: CoreVar; // which ONE core variable it affects
}

export interface AgentRuntime {
  agentId: string;
  state: AgentState;
  mode: StrategyMode;
  narrative: string;
  opportunities: string[]; // open paths
  closed: string[];        // foreclosed paths
  consistencyStreak?: number; // consecutive rounds with consistency > 0.6
  opportunityCards?: OpportunityCard[];
  trajectoryProbability?: number; // 0-100 LLM-assessed
  history: { round: number; action: AgentAction; outcome: "success" | "failure" | "neutral"; note: string }[];
  // v4
  traits?: AgentTraits;
  rank?: number;          // 1 = best
  pathLocked?: boolean;   // skill_depth > threshold
  causalChain?: CausalChainEntry[];
  microFailures?: MicroFailure[];
  // v5 — seed-extracted core engine
  core?: CoreState;
  customVars?: CustomVariable[];
  successStreak?: number;
  failureStreak?: number;
  cascade?: boolean;      // transient flag
  identity_conflict?: number; // 0..1
  timePressure?: number;  // 0..1, grows by round
  modeV5?: "growth" | "recovery" | "fragile" | "collapse" | "steady" | "spike" | "avoid";
  // v6.1 — emotional realism
  emotionalAnchor?: EmotionalAnchor;
  selfPerceptionBias?: number; // derived: anxiety * 0.5
  // v6.5 — bidirectional causal bridge (Mind ↔ World)
  pendingIntent?: AgentIntent;       // emitted this round, resolved next
  lastIntent?: AgentIntent;          // most recent emitted intent
  lastPerceivedEvent?: PerceivedEvent; // most recent filtered world event
  lastResolvedOutcome?: ResolvedOutcome; // resolution of previous-round intent
  // v6.6 — cognitive dissonance (transient, derived per round)
  contradictionScore?: number;          // 0..1
  topOpposingSources?: (string | null)[]; // 2 most opposing peer ids
  // v8 — Hippocampal Episodic Replay (world-owned buffer, agent reads only)
  episodicBuffer?: EpisodicTrace[];     // FIFO, max 10
  lastReplayedTraceRound?: number | null; // round of trace that triggered replay this round
}

export interface EpisodicTrace {
  round: number;
  event_type: "cascade" | "salient_change";
  snapshot: {
    self_worth: number;
    anxiety: number;
    momentum: number;
    reputation: number;
    opportunity_access: number;
  };
  delta_vector: [number, number, number, number, number]; // Δ of the 5 above
  valence: -1 | 0 | 1;
}

// v6.5 — Bridge layer types
export interface AgentIntent {
  round: number;
  type: "AVOID" | "RECOVER" | "EXECUTE" | "OPTIMIZE";
  strength: number;          // 0..1
  targetId: string | null;   // sampled via softmax over existence_value
  targetExistenceValue: number;
}

export interface PerceivedEvent {
  round: number;
  kind: "success" | "failure" | "social_feedback" | "mentor" | "event";
  raw: number;
  perceived: number;
  sourceId: string | null;   // null = self-caused
  existenceValue: number;
  phenomPenetration: number;
}

export interface ResolvedOutcome {
  round: number;              // round in which the intent was emitted
  resolvedAt: number;         // round in which it was resolved
  intentType: AgentIntent["type"];
  effectiveSuccess: number;   // 0..1
  visibility: number;
  outcome: "success" | "failure" | "neutral";
}

export interface ActiveLoop {
  agentId: string;
  kind: "negative" | "positive";
  rounds: number[];
  description: string;
}

export interface LoopAnalysis {
  loops: { agentId: string; pattern: string; rounds: number[]; impact: string }[];
  compoundEffects: string[];
  tippingPoints: { agentId: string; threshold: string; round: number }[];
}

export interface Round {
  index: number;
  director: string;
  feed: FeedItem[];
  // advanced
  stateSnapshot?: Record<string, AgentRuntime>;
  events?: { agentId: string; kind: string; description: string }[];
}

export interface AssassinReport {
  assumption: string;
  whyFragile: string;
  breakScenario: string;
  impactIfBroken: string;
  probability?: number;
}

// v6.7 — multi-dimensional confidence breakdown (derived, not persistent state)
export interface ConfidenceBreakdownPersisted {
  structuralFeasibility: number; // 0..10
  stakeholderAlignment: number;  // 0..10
  riskExposure: number;          // 0..10 (10 = safe)
  evidenceStrength: number;      // 0..10
  justifications?: {
    structuralFeasibility?: string;
    stakeholderAlignment?: string;
    riskExposure?: string;
    evidenceStrength?: string;
  };
  framework?: string | null;
}

export interface Report {
  winner: string;
  confidence: number;
  scores: { label: string; value: number }[];
  bestCase: string;
  worstCase: string;
  hiddenFailures: string[];
  timeline: { period: string; event: string }[];
  summary: string;
  loopAnalysis?: LoopAnalysis;
  assassin?: AssassinReport;
  confidenceBreakdown?: ConfidenceBreakdownPersisted;
}

export interface Simulation {
  id: string;
  seed: string;
  ontology: OntologyNode[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  agentIds: string[];
  rounds: Round[];
  report?: Report;
  createdAt: number;
  status: "draft" | "setup" | "agents" | "running" | "done";
  // advanced
  advanced?: boolean;
  runtime?: Record<string, AgentRuntime>;
  // v6.4 — reproducibility & learning
  prngSeed?: number;          // mulberry32 seed for stochastic events
  pastInsight?: string;       // injected from prior runs (advanced only)
  // v6.7 — institutional reasoning layer (prompt-level, no state mutation)
  swarmMode?: "debate" | "council" | "devils_advocate" | "exploration" | "rapid_fire" | "institutional";
  institutionalFramework?: "courtroom" | "policy_panel" | "pre_mortem" | "grant_panel" | "intelligence_analysis" | null;
  // v8 — Hippocampal Episodic Replay (experimental)
  episodicReplay?: boolean;
}

// v6.4 — persistent learning summary (last 30 runs)
export interface LearningSummary {
  id: string;
  ts: number;
  keywords: string[];
  topVars: string[];
  outcome: "growth" | "collapse" | "recovery" | "steady" | "fragile" | "spike" | "avoid";
  confidence: number;
  prngSeed?: number;
}

