// Nyx AI gateway router
// Handles tasks: ontology, graph, round, report, chat
// Uses Lovable AI Gateway with structured tool-calling for JSON.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

async function structured(prompt: string, system: string, name: string, parameters: Record<string, unknown>) {
  const data = await callAI({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    tools: [{ type: "function", function: { name, description: name, parameters } }],
    tool_choice: { type: "function", function: { name } },
  });
  return extractToolArgs(data);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const payload = await req.json();
    const task = payload.task as string;

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

    if (task === "round") {
      const ids = payload.agentIds as string[];
      const agents = ids.map((id) => ({ id, ...NYX_AGENTS[id] })).filter((a) => a.name);
      const advanced = !!payload.advanced;
      const runtime = payload.runtime ?? [];
      const events = payload.events ?? [];

      const advancedBlock = advanced
        ? `\n\nADVANCED CAUSAL MODE — RESPECT STRICTLY:\nEach agent has numeric state, a strategy mode, a self-narrative, opportunity surfaces, and an action bias.\nAgent runtime:\n${JSON.stringify(runtime)}\n\nRules you MUST follow:\n- Speak in each agent's voice CONDITIONED on their current state and narrative.\n- If bias.preferred includes IDLE/MUTE/WITHDRAW, that agent MUST mostly choose those actions (silence, opt-out, or one short withdrawn line).\n- If bias.suppressed includes POST, do not have that agent post boldly.\n- mode "support_collapse": agent withdraws or speaks fragmentary, low-energy lines.\n- mode "optimization": agent posts decisive, high-signal content.\n- mode "avoidance": agent likes/idles, deflects.\n- mode "recovery": tentative comments, tries again.\n- Use the LLM (you) to assess CONDITIONAL outcome probabilities at key moments based on world state — do not invent fixed numbers; only set "outcomeProbabilities" when a moment is pivotal.\n- Random events already happened this round (do not repeat them as posts, but you may have other agents react): ${JSON.stringify(events)}\n- Allowed actions: POST, COMMENT, LIKE, REPOST, IDLE, MUTE, WITHDRAW.`
        : `\n\nStandard Nyx debate mode. Allowed actions: POST, COMMENT, LIKE, REPOST.`;

      const out = await structured(
        `Seed: ${payload.seed}\nOntology: ${JSON.stringify(payload.ontology)}\nRound ${payload.round} of ${payload.totalRounds}.\nPrior director notes: ${JSON.stringify(payload.prior ?? [])}\nAgents: ${JSON.stringify(agents)}\nOptions: ${JSON.stringify(payload.opts)}${advancedBlock}\n\nGenerate 8-12 short feed posts (mix across allowed actions) split between twitter and reddit, each in the agent's distinct voice. Then a 2-sentence director summary. ${advanced ? 'When relevant, include outcomeProbabilities for 1-3 pivotal moments this round.' : ''}`,
        "You simulate a multi-agent strategy room. Each post 1-2 short sentences, sharp and in-character. In advanced mode, agent psychology dictates action choice.",
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
      const out = await structured(
        `Seed: ${payload.seed}\nOntology: ${JSON.stringify(payload.ontology)}\nRounds (director notes & feed): ${JSON.stringify(payload.rounds)}${payload.advanced ? `\n\nADVANCED CAUSAL MODE: Final agent runtime (state, mode, narrative): ${JSON.stringify(payload.runtime)}\nIn the report, weight verdict by causal trajectories — who collapsed, who compounded gains, which feedback loops dominated. Use LLM-assessed conditional probabilities, not fixed numbers.` : ""}\n\nProduce a Strategic Forecast Report.`,
        "You are Vera, the Nyx Report Agent. Synthesize the simulation into a clear, decision-ready forecast.",
        "report",
        {
          type: "object",
          properties: {
            report: {
              type: "object",
              properties: {
                winner: { type: "string", description: "Recommended path or chosen option, one short phrase" },
                confidence: { type: "number", description: "0..1" },
                summary: { type: "string" },
                bestCase: { type: "string" },
                worstCase: { type: "string" },
                hiddenFailures: { type: "array", items: { type: "string" } },
                timeline: { type: "array", items: { type: "object", properties: { period: { type: "string" }, event: { type: "string" } }, required: ["period", "event"] } },
                scores: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: "number" } }, required: ["label", "value"] } },
              },
              required: ["winner", "confidence", "summary", "bestCase", "worstCase", "hiddenFailures", "timeline", "scores"],
            },
          },
          required: ["report"],
        }
      );
      return Response.json(out, { headers: corsHeaders });
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

    return new Response(JSON.stringify({ error: "unknown task" }), { status: 400, headers: corsHeaders });
  } catch (e) {
    console.error("nyx-ai error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
