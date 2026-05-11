// Nyx AI gateway router
// Handles tasks: ontology, graph, round, report, chat
// Uses Lovable AI Gateway with structured tool-calling for JSON.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_TASKS = new Set([
  "ontology", "graph", "init_advanced", "round", "report", "chat", "assassin", "game_theory",
]);

const MAX_STR = 4000;
const MAX_JSON_CHARS = 20000;

function clampStr(v: unknown, max = MAX_STR): string {
  if (typeof v !== "string") return "";
  return v.length > max ? v.slice(0, max) : v;
}

function clampJson(v: unknown, max = MAX_JSON_CHARS): unknown {
  try {
    const s = JSON.stringify(v ?? null);
    if (s.length <= max) return v;
    // Truncate by re-serializing as a safe stub
    return { _truncated: true, preview: s.slice(0, 1000) };
  } catch {
    return null;
  }
}

async function verifyAuth(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);
  if (!token) return false;
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !anon) return false;
  try {
    const supabase = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getUser(token);
    return !error && !!data?.user;
  } catch {
    return false;
  }
}

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

const NYX_AGENTS: Record<string, { name: string; role: string; personality: string }> = {
  harsh: { name: "Harsh", role: "Brutal Critic", personality: "Cuts through hype" },
  jayant: { name: "Jayant", role: "Strategic Architect", personality: "Three moves ahead" },
  nova: { name: "Nova", role: "Trend Forecaster", personality: "Reads weak signals" },
  atlas: { name: "Atlas", role: "Systems Thinker", personality: "Maps second-order effects" },
  lyra: { name: "Lyra", role: "Ethical Compass", personality: "Holds the moral line" },
  kai: { name: "Kai", role: "Devil's Advocate", personality: "Argues opposite" },
  mira: { name: "Mira", role: "Market Analyst", personality: "Numbers first" },
  echo: { name: "Echo", role: "Cultural Voice", personality: "Sentiment translator" },
  vox: { name: "Vox", role: "Public Opinion", personality: "Crowd's gut reaction" },
  ren: { name: "Ren", role: "Operator", personality: "Execution feasibility" },
  sage: { name: "Sage", role: "Historian", personality: "Precedent" },
  iris: { name: "Iris", role: "UX Empath", personality: "Hates friction" },
  orion: { name: "Orion", role: "Tech Futurist", personality: "AI in 2030" },
  juno: { name: "Juno", role: "Investor Lens", personality: "Moat and exit" },
  thane: { name: "Thane", role: "Legal Risk", personality: "Reads fine print" },
  wren: { name: "Wren", role: "Wildcard", personality: "Lateral move" },
  sol: { name: "Sol", role: "Optimist", personality: "Builds momentum" },
  noor: { name: "Noor", role: "Pragmatist", personality: "Shippable steps" },
  arc: { name: "Arc", role: "Director", personality: "Synthesizer" },
  vera: { name: "Vera", role: "Report Agent", personality: "Clarity from chaos" },
  blackswan: { name: "BlackSwan Assassin", role: "Adversarial Auditor", personality: "Hunts the one fragile assumption everyone shares" },
};

async function callAI(body: Record<string, unknown>) {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  const r = await fetch(GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, ...body }),
  });
  if (r.status === 429) throw new Error("Rate limit reached. Please retry shortly.");
  if (r.status === 402) throw new Error("AI credits exhausted. Add credits in Settings → Workspace → Usage.");
  if (!r.ok) throw new Error(`AI gateway error ${r.status}: ${await r.text()}`);
  return r.json();
}

function extractToolArgs(data: Record<string, unknown>): Record<string, unknown> {
  // deno-lint-ignore no-explicit-any
  const choice: any = (data as any).choices?.[0];
  const tc = choice?.message?.tool_calls?.[0];
  if (tc?.function?.arguments) {
    try { return JSON.parse(tc.function.arguments); } catch { /* ignore */ }
  }
  // fallback: try parse content as JSON
  const content = choice?.message?.content;
  if (typeof content === "string") {
    try { return JSON.parse(content); } catch { /* ignore */ }
  }
  return {};
}

async function structured(
  prompt: string,
  system: string,
  name: string,
  parameters: Record<string, unknown>,
  sampling?: { temperature?: number; top_p?: number },
) {
  const body: Record<string, unknown> = {
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    tools: [{ type: "function", function: { name, description: name, parameters } }],
    tool_choice: { type: "function", function: { name } },
  };
  if (sampling?.temperature !== undefined) body.temperature = sampling.temperature;
  if (sampling?.top_p !== undefined) body.top_p = sampling.top_p;
  const data = await callAI(body);
  return extractToolArgs(data);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const ok = await verifyAuth(req);
    if (!ok) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const payload = await req.json();
    const task = payload.task as string;
    if (typeof task !== "string" || !ALLOWED_TASKS.has(task)) {
      return new Response(JSON.stringify({ error: "Invalid task" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Clamp common user-supplied prompt fields
    if ("seed" in payload) payload.seed = clampStr(payload.seed, 4000);
    if ("ontology" in payload) payload.ontology = clampJson(payload.ontology);
    if ("rounds" in payload && typeof payload.rounds !== "number") payload.rounds = clampJson(payload.rounds);
    if ("runtime" in payload) payload.runtime = clampJson(payload.runtime);
    if ("prior" in payload) payload.prior = clampJson(payload.prior);
    if ("history" in payload && Array.isArray(payload.history)) {
      payload.history = payload.history.slice(-12).map((m: { role?: string; content?: unknown }) => ({
        role: typeof m?.role === "string" ? m.role : "user",
        content: clampStr(m?.content, 2000),
      }));
    }
    if ("pastInsight" in payload) payload.pastInsight = clampStr(payload.pastInsight, 2000);

    if (task === "ontology") {
      const out = await structured(
        `Seed: ${payload.seed}\n\nProduce 6-8 ontology entities (key concepts, actors, forces) for strategic simulation.`,
        "You design ontologies for strategic simulations. Be concise and incisive.",
        "ontology",
        {
          type: "object",
          properties: {
            ontology: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" }, label: { type: "string" },
                  type: { type: "string", enum: ["actor", "force", "concept", "constraint", "outcome"] },
                  description: { type: "string" },
                },
                required: ["id", "label", "type", "description"],
              },
            },
          },
          required: ["ontology"],
        }
      );
      return Response.json(out, { headers: corsHeaders });
    }

    if (task === "graph") {
      const out = await structured(
        `Seed: ${payload.seed}\nOntology: ${JSON.stringify(payload.ontology)}\n\nProduce a knowledge graph: nodes (one per ontology id) and 8-14 weighted edges between them.`,
        "You build knowledge graphs. Group related nodes (group: 0-4) and weight edges 1-3.",
        "graph",
        {
          type: "object",
          properties: {
            graph: {
              type: "object",
              properties: {
                nodes: { type: "array", items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" }, group: { type: "integer" } }, required: ["id", "label", "group"] } },
                edges: { type: "array", items: { type: "object", properties: { source: { type: "string" }, target: { type: "string" }, weight: { type: "integer" } }, required: ["source", "target", "weight"] } },
              },
              required: ["nodes", "edges"],
            },
          },
          required: ["graph"],
        }
      );
      return Response.json(out, { headers: corsHeaders });
    }

    if (task === "init_advanced") {
      const ids = (payload.agentIds as string[]) ?? [];
      const agents = ids.map((id) => ({ id, ...NYX_AGENTS[id] })).filter((a) => a.name);
      const agentNames = agents.map((a) => a.name);
      const seed = payload.seed as string;

      const coreSchema = {
        type: "object",
        properties: {
          self_worth: { type: "number", minimum: 0, maximum: 1 },
          anxiety: { type: "number", minimum: 0, maximum: 1 },
          consistency: { type: "number", minimum: 0, maximum: 1 },
          momentum: { type: "number", minimum: 0, maximum: 1 },
          reputation: { type: "number", minimum: 0, maximum: 1 },
          opportunity_access: { type: "number", minimum: 0, maximum: 1 },
          fragility_index: { type: "number", minimum: 0, maximum: 1 },
          lock_in: { type: "number", minimum: 0, maximum: 1 },
          learning_rate: { type: "number", minimum: 0, maximum: 1 },
          energy: { type: "number", minimum: 0, maximum: 1 },
        },
        required: [
          "self_worth", "anxiety", "consistency", "momentum", "reputation",
          "opportunity_access", "fragility_index", "lock_in", "learning_rate", "energy",
        ],
      };

      const customSchema = {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            value: { type: "number" },
            min: { type: "number" },
            max: { type: "number" },
            affects: {
              type: "string",
              enum: [
                "self_worth", "anxiety", "consistency", "momentum", "reputation",
                "opportunity_access", "fragility_index", "lock_in", "learning_rate", "energy",
              ],
            },
          },
          required: ["name", "value", "min", "max", "affects"],
        },
      };

      const sys =
        "You initialize realistic numeric agent state for a causal simulation. Output strict JSON via the tool. Base values on the scenario (e.g. a failed student → low self_worth, high anxiety; a supportive parent → high consistency, moderate expectations). All core values must be in 0..1. If the scenario describes a deep attachment (a person, loss, relationship, lost dream), include an optional emotionalAnchor for that agent: { name, intensity (0..1), valence (-1..1, negative = painful loss / positive = sustaining bond) }.";
      const user =
        `Analyze the following scenario and extract initial state for these agents: ${JSON.stringify(agentNames)}.\n\nFor EACH agent name above, return: a "core" object with the 10 required variables (all 0..1), plus up to 3 scenario-specific "custom" variables (each with name, value, range min/max, and which ONE core variable it affects). Base values realistically on the scenario.\n\nScenario:\n${seed}`;

      const params = {
        type: "object",
        properties: {
          agents: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                core: coreSchema,
                custom: customSchema,
                emotionalAnchor: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    intensity: { type: "number", minimum: 0, maximum: 1 },
                    valence: { type: "number", minimum: -1, maximum: 1 },
                  },
                  required: ["name", "intensity", "valence"],
                },
              },
              required: ["name", "core"],
            },
          },
        },
        required: ["agents"],
      };

      let raw = await structured(user, sys, "init_advanced", params);
      // retry once if missing/invalid
      const isValid = (r: Record<string, unknown>) => {
        const arr = (r as { agents?: unknown[] }).agents;
        if (!Array.isArray(arr) || arr.length === 0) return false;
        for (const a of arr) {
          const ag = a as { name?: string; core?: Record<string, unknown> };
          if (!ag.name || !ag.core) return false;
          for (const k of ["self_worth","anxiety","consistency","momentum","reputation","opportunity_access","fragility_index","lock_in","learning_rate","energy"]) {
            const v = ag.core[k];
            if (typeof v !== "number" || v < 0 || v > 1) return false;
          }
        }
        return true;
      };
      if (!isValid(raw)) {
        raw = await structured(user, sys, "init_advanced", params);
      }
      // Reshape to { [agentName]: { core, custom } }
      const arr = (raw as { agents?: { name: string; core: Record<string, number>; custom?: unknown[]; emotionalAnchor?: { name: string; intensity: number; valence: number } }[] }).agents ?? [];
      const out: Record<string, { core: Record<string, number>; custom: unknown[]; emotionalAnchor?: { name: string; intensity: number; valence: number } }> = {};
      for (const a of arr) {
        out[a.name] = { core: a.core, custom: a.custom ?? [], emotionalAnchor: a.emotionalAnchor };
      }
      return Response.json({ extracted: out, valid: isValid(raw) }, { headers: corsHeaders });
    }

    if (task === "round") {
      const ids = payload.agentIds as string[];
      const agents = ids.map((id) => ({ id, ...NYX_AGENTS[id] })).filter((a) => a.name);
      const advanced = !!payload.advanced;
      const runtime = payload.runtime ?? [];
      const events = payload.events ?? [];

      const advancedBlock = advanced
        ? `\n\nADVANCED CAUSAL MODE — RESPECT STRICTLY:\nEach agent has numeric state, a strategy mode, a self-narrative, opportunity surfaces, and an action bias.\nAgent runtime:\n${JSON.stringify(runtime)}\n\nRules you MUST follow:\n- Speak in each agent's voice CONDITIONED on their current state and narrative.\n- If bias.preferred includes IDLE/MUTE/WITHDRAW, that agent MUST mostly choose those actions (silence, opt-out, or one short withdrawn line).\n- If bias.suppressed includes POST, do not have that agent post boldly.\n- mode "support_collapse": agent withdraws or speaks fragmentary, low-energy lines.\n- mode "optimization": agent posts decisive, high-signal content.\n- mode "avoidance": agent likes/idles, deflects.\n- mode "recovery": tentative comments, tries again.\n- Use the LLM (you) to assess CONDITIONAL outcome probabilities at key moments based on world state — do not invent fixed numbers; only set "outcomeProbabilities" when a moment is pivotal.\n- Random events already happened this round (do not repeat them as posts, but you may have other agents react): ${JSON.stringify(events)}\n- Allowed actions: POST, COMMENT, LIKE, REPOST, IDLE, MUTE, WITHDRAW.`
        : `\n\nStandard Nyx debate mode. Allowed actions: POST, COMMENT, LIKE, REPOST.`;

      // v6.7 — institutional framework prompt injection (advanced + institutional swarm mode only)
      const institutionalBlock =
        advanced && payload.institutional
          ? `\n\nINSTITUTIONAL REASONING LAYER — ACTIVE\nFramework: ${payload.institutional.framework}\nProtocol: ${payload.institutional.protocol}\nRole bindings (override agent personas for this run): ${JSON.stringify(payload.institutional.roleBindings)}\n\nEach agent MUST speak strictly in their assigned institutional role and follow the protocol stage corresponding to round ${payload.round}/${payload.totalRounds}. Maintain adversarial / structured behavior demanded by the role (e.g. Prosecutor pushes guilt, Defense rebuts, Jurors weigh; Pessimists list failure modes; Hypothesis Analysts argue competing causes). Do NOT break role.`
          : "";

      const out = await structured(
        `Seed: ${payload.seed}\nOntology: ${JSON.stringify(payload.ontology)}\nRound ${payload.round} of ${payload.totalRounds}.\nPrior director notes: ${JSON.stringify(payload.prior ?? [])}\nAgents: ${JSON.stringify(agents)}\nOptions: ${JSON.stringify(payload.opts)}${advancedBlock}${institutionalBlock}${payload.pastInsight ? `\n\nPRIOR-RUN INSIGHT (from past similar simulations):\n${payload.pastInsight}` : ""}\n\nGenerate 8-12 short feed posts (mix across allowed actions) split between twitter and reddit, each in the agent's distinct voice. Then a 2-sentence director summary. ${advanced ? 'When relevant, include outcomeProbabilities for 1-3 pivotal moments this round.' : ''}`,
        "You simulate a multi-agent strategy room. Each post 1-2 short sentences, sharp and in-character. In advanced mode, agent psychology dictates action choice. In institutional mode, agents are role-bound to their assigned institutional position.",
        "round",
        {
          type: "object",
          properties: {
            director: { type: "string" },
            feed: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  agentId: { type: "string" },
                  agentName: { type: "string" },
                  agentAvatar: { type: "string" },
                  platform: { type: "string", enum: ["twitter", "reddit"] },
                  action: { type: "string", enum: ["POST", "COMMENT", "LIKE", "REPOST", "IDLE", "MUTE", "WITHDRAW"] },
                  content: { type: "string" },
                  ts: { type: "integer" },
                  likes: { type: "integer" },
                  replies: { type: "integer" },
                },
                required: ["id", "agentId", "agentName", "agentAvatar", "platform", "action", "content", "ts"],
              },
            },
            outcomeProbabilities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  moment: { type: "string" },
                  outcome: { type: "string" },
                  probability: { type: "number" },
                  rationale: { type: "string" },
                },
                required: ["moment", "outcome", "probability"],
              },
            },
          },
          required: ["director", "feed"],
        }
      );
      return Response.json(out, { headers: corsHeaders });
    }

    if (task === "report") {
      const institutionalReportBlock = payload.advanced && payload.institutional
        ? `\n\nINSTITUTIONAL FRAMEWORK ACTIVE: ${payload.institutional.framework}. Protocol: ${payload.institutional.protocol}. Frame the verdict in the language of this institution (e.g. courtroom: verdict + standard of proof; policy panel: vote outcome + amendments; pre-mortem: top failure modes; grant panel: ranked allocation; intelligence: most-supported hypothesis).`
        : "";
      const confidenceRubric = payload.advanced
        ? `\n\nCONFIDENCE RUBRIC — REQUIRED:\nIn addition to the standard fields, you MUST output a "confidenceBreakdown" object with FOUR independent integer scores 0..10 and a one-sentence justification each. Score them honestly based on the actual simulation dynamics — DO NOT default to a middle value. Variation across scenarios is required.\n\n- structuralFeasibility (0..10): Can the winning path actually be implemented under the scenario's constraints?\n- stakeholderAlignment (0..10): How well does the winner's position align with key stakeholders' interests?\n- riskExposure (0..10, INVERTED): How safe from cascading failure is the winning position? 10 = very safe, 0 = extremely risky.\n- evidenceStrength (0..10): How well-supported is the winner's position by evidence and rebuttal quality observed across rounds?\n\nThe top-level "confidence" field is IGNORED in advanced mode — the client recomputes it from the breakdown using framework-specific weights. Still output a placeholder confidence value (it will be overwritten).`
        : "";
      // v6.8 — Trajectory binding (advanced + kernel active): hard-bind verdict
      // synthesis to deterministic kernel metrics.
      const trajectory = payload.advanced && payload.trajectory ? payload.trajectory : null;
      const trajectoryBlock = trajectory
        ? `\n\nVERDICT MODE: ${trajectory.verdictMode}\n\nDETERMINISTIC KERNEL METRICS (authoritative — your verdict MUST reflect these):\n- Δ reputation_mean: ${Number(trajectory.deltaReputationMean).toFixed(3)}\n- Δ inequality: ${Number(trajectory.deltaInequality).toFixed(3)}\n- Δ trust_proxy: ${Number(trajectory.deltaTrustProxy).toFixed(3)}\n- Δ centralization: ${Number(trajectory.deltaCentralization).toFixed(3)}\n- final centralization: ${Number(trajectory.finalCentralization).toFixed(3)}\n- polarization_score: ${Number(trajectory.polarizationScore).toFixed(3)}\n- convergence_score: ${Number(trajectory.convergenceScore).toFixed(3)}\n- instability_index: ${Number(trajectory.instabilityIndex).toFixed(3)}\n- dominant_trend: ${trajectory.dominantTrend}\n\nHARD VERDICT RULES (MUST be obeyed):\n${(trajectory.hardRules as string[]).map((r: string) => `- ${r}`).join("\n")}`
        : "";

      const judgeSystem = trajectory
        ? `VERDICT MODE: ${trajectory.verdictMode}\n\nYou are a simulation adjudicator. You MUST derive conclusions directly from the measured state trajectories and outcome metrics provided below. Do NOT generate compromise conclusions unless the kernel metrics indicate convergence and stability. If metrics indicate polarization, fragmentation, distrust, instability, or asymmetric impact, the verdict MUST explicitly reflect those dynamics. You are translating quantitative evidence into readable language — not inventing a narrative. The narrative layer is downstream of the deterministic kernel; you are NOT allowed to override the kernel-derived classification.`
        : "You are Vera, the Nyx Report Agent. Synthesize the simulation into a clear, decision-ready forecast.";

      const out = await structured(
        `Seed: ${payload.seed}\nOntology: ${JSON.stringify(payload.ontology)}\nRounds (director notes & feed): ${JSON.stringify(payload.rounds)}${payload.advanced ? `\n\nADVANCED CAUSAL MODE: Final agent runtime (state, mode, narrative): ${JSON.stringify(payload.runtime)}\nIn the report, weight verdict by causal trajectories — who collapsed, who compounded gains, which feedback loops dominated. Use LLM-assessed conditional probabilities, not fixed numbers.` : ""}${trajectoryBlock}${institutionalReportBlock}${confidenceRubric}\n\nProduce a Strategic Forecast Report.`,
        judgeSystem,
        "report",
        {
          type: "object",
          properties: {
            report: {
              type: "object",
              properties: {
                winner: { type: "string", description: "Recommended path or chosen option, one short phrase" },
                confidence: { type: "number", description: "0..1 (overwritten in advanced mode)" },
                summary: { type: "string" },
                bestCase: { type: "string" },
                worstCase: { type: "string" },
                hiddenFailures: { type: "array", items: { type: "string" } },
                timeline: { type: "array", items: { type: "object", properties: { period: { type: "string" }, event: { type: "string" } }, required: ["period", "event"] } },
                scores: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: "number" } }, required: ["label", "value"] } },
                confidenceBreakdown: {
                  type: "object",
                  properties: {
                    structuralFeasibility: { type: "number", minimum: 0, maximum: 10 },
                    stakeholderAlignment: { type: "number", minimum: 0, maximum: 10 },
                    riskExposure: { type: "number", minimum: 0, maximum: 10 },
                    evidenceStrength: { type: "number", minimum: 0, maximum: 10 },
                    justifications: {
                      type: "object",
                      properties: {
                        structuralFeasibility: { type: "string" },
                        stakeholderAlignment: { type: "string" },
                        riskExposure: { type: "string" },
                        evidenceStrength: { type: "string" },
                      },
                    },
                  },
                  required: ["structuralFeasibility", "stakeholderAlignment", "riskExposure", "evidenceStrength"],
                },
              },
              required: ["winner", "confidence", "summary", "bestCase", "worstCase", "hiddenFailures", "timeline", "scores"],
            },
          },
          required: ["report"],
        },
        trajectory ? { temperature: 0.3, top_p: 0.7 } : undefined,
      );
      return Response.json(out, { headers: corsHeaders });
    }

    if (task === "assassin") {
      const out = await structured(
        `Seed: ${payload.seed}\nRounds so far (director notes & feed): ${JSON.stringify(payload.rounds)}\nCurrent agent runtime (state, mode, narrative): ${JSON.stringify(payload.runtime)}\n\nIdentify the ONE most fragile assumption the other agents implicitly agree on. Anchor your critique in the actual numeric state variables shown (consistency, anxiety, self_worth, momentum, reputation, fragility_index, opportunity_access, lock_in, learning_rate, energy). Be concrete and quantitative — if this assumption were wrong, exactly how would the outcome change? Describe a break scenario where the most exposed variable shifts by 20% in the opposite direction.\n\nALSO output the SINGLE core variable that, if perturbed by ±20%, would most invalidate the consensus, and the direction (up or down) of that perturbation.`,
        "You are the BlackSwan Assassin. Your job is to find the ONE most fragile assumption the other agents agree on. Anchor your criticism in the simulation's actual state variables (consistency, anxiety, self_worth, etc.). Be concrete and quantitative — if an assumption were wrong, exactly how would that change the outcome?",
        "assassin",
        {
          type: "object",
          properties: {
            assumption: { type: "string" },
            whyFragile: { type: "string" },
            breakScenario: { type: "string" },
            impactIfBroken: { type: "string" },
            probability: { type: "number" },
            targetVariable: {
              type: "string",
              enum: [
                "self_worth", "anxiety", "consistency", "momentum", "reputation",
                "opportunity_access", "fragility_index", "lock_in", "learning_rate", "energy",
              ],
            },
            perturbationDirection: { type: "string", enum: ["up", "down"] },
          },
          required: ["assumption", "whyFragile", "breakScenario", "impactIfBroken", "targetVariable", "perturbationDirection"],
        }
      );
      return Response.json({ assassin: out }, { headers: corsHeaders });
    }

    if (task === "chat") {
      const a = NYX_AGENTS[payload.agentId] ?? NYX_AGENTS.vera;
      // deno-lint-ignore no-explicit-any
      const history = (payload.history as any[]) ?? [];
      const data = await callAI({
        messages: [
          { role: "system", content: `You are ${a.name}, the ${a.role} on the Nyx panel. Personality: ${a.personality}. Stay in character. 1-3 sentences.\n\nSimulation seed: ${payload.seed}\nReport summary: ${payload.report?.summary ?? ""}` },
          ...history.map((m) => ({ role: m.role, content: m.content })),
        ],
      });
      // deno-lint-ignore no-explicit-any
      const reply = (data as any).choices?.[0]?.message?.content ?? "";
      return Response.json({ reply }, { headers: corsHeaders });
    }

    if (task === "game_theory") {
      // v8 — game-theoretic decomposition via Lovable AI Gateway.
      const agents = payload.agents ?? [];
      const sys = `You are a game-theory analyst. Given final agent states from a strategic simulation, return STRICT JSON:
{
  "nashEquilibria": string[],            // 1-3 short labels
  "dominantStrategies": [{"agentId": string, "strategy": string}],
  "paretoFrontier": string[],            // 1-3 short labels
  "rationalityGap": string,              // 1-2 sentences
  "summary": string                      // 1-3 sentences
}
No prose outside JSON.`;
      const data = await callAI({
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `Seed: ${payload.seed}\nRounds: ${payload.rounds}\nAgents:\n${JSON.stringify(agents).slice(0, 4000)}` },
        ],
      });
      // deno-lint-ignore no-explicit-any
      const raw = (data as any).choices?.[0]?.message?.content ?? "{}";
      let parsed: Record<string, unknown> = {};
      try {
        const m = raw.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(m ? m[0] : raw);
      } catch { parsed = {}; }
      return Response.json(parsed, { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: "unknown task" }), { status: 400, headers: corsHeaders });
  } catch (e) {
    console.error("nyx-ai error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
