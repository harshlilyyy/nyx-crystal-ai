export type AgentAction = "POST" | "COMMENT" | "LIKE" | "REPOST";

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
}

export interface Round {
  index: number;
  director: string;
  feed: FeedItem[];
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
}
