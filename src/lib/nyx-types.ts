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
  energy: number;
}

export type StrategyMode = "avoidance" | "recovery" | "exploration" | "optimization" | "support_collapse";

export interface AgentRuntime {
  agentId: string;
  state: AgentState;
  mode: StrategyMode;
  narrative: string;
  opportunities: string[]; // open paths
  closed: string[];        // foreclosed paths
  history: { round: number; action: AgentAction; outcome: "success" | "failure" | "neutral"; note: string }[];
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
}
