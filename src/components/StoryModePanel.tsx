// Story Mode — seeded narrative summary of a finished simulation.
// LLM-generated but reproducible: caches result per simulation id in localStorage.
import { useEffect, useState } from "react";
import { Loader2, Sparkles, RefreshCw, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Simulation } from "@/lib/nyx-types";
import { NYX_AGENTS } from "@/lib/nyx-agents";

const CACHE_KEY = "nyx_story_cache_v1";

interface StoryCache { [simId: string]: { story: string; seed: string; ts: number } }

function readCache(): StoryCache {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}"); } catch { return {}; }
}
function writeCache(c: StoryCache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* noop */ }
}

export function StoryModePanel({ sim, onStoryReady }: { sim: Simulation; onStoryReady?: (story: string) => void }) {
  const [story, setStory] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const cached = readCache()[sim.id];
    if (cached && cached.seed === sim.seed) {
      setStory(cached.story);
      onStoryReady?.(cached.story);
    }
  }, [sim.id, sim.seed, onStoryReady]);

  async function generate(force = false) {
    if (busy) return;
    if (!force) {
      const cached = readCache()[sim.id];
      if (cached && cached.seed === sim.seed) {
        setStory(cached.story);
        return;
      }
    }
    setBusy(true);
    try {
      const agentNames = sim.agentIds
        .map((id) => NYX_AGENTS.find((a) => a.id === id)?.name ?? id)
        .filter(Boolean);
      const roundsSlim = (sim.rounds ?? []).slice(0, 8).map((r) => ({
        index: r.index,
        director: r.director,
        moments: (r.feed ?? []).slice(0, 4).map((f) => ({
          who: f.agentName, action: f.action, line: (f.content ?? "").slice(0, 220),
        })),
      }));
      const { data, error } = await supabase.functions.invoke("nyx-ai", {
        body: {
          task: "story",
          seed: sim.seed,
          prngSeed: sim.prngSeed,
          report: sim.report,
          rounds: roundsSlim,
          agents: agentNames,
        },
      });
      if (error) throw error;
      const text = (data?.story ?? "").toString().trim();
      if (!text) throw new Error("Empty story");
      setStory(text);
      const cache = readCache();
      cache[sim.id] = { story: text, seed: sim.seed, ts: Date.now() };
      writeCache(cache);
      onStoryReady?.(text);
      toast.success("Story generated");
    } catch (e: unknown) {
      // Deterministic fallback so the panel never feels broken.
      const fb = buildFallback(sim);
      setStory(fb);
      const cache = readCache();
      cache[sim.id] = { story: fb, seed: sim.seed, ts: Date.now() };
      writeCache(cache);
      onStoryReady?.(fb);
      toast.error(e instanceof Error ? e.message : "Story fallback used");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass rounded-[24px] p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" /> Story Mode
        </div>
        {story && (
          <button
            onClick={async () => { await navigator.clipboard.writeText(story); toast.success("Copied"); }}
            className="rounded-full bg-secondary/60 px-2 py-0.5 text-[9px] uppercase tracking-wider text-secondary-foreground"
            aria-label="Copy story"
          >
            <Copy className="inline h-2.5 w-2.5 mr-1" />copy
          </button>
        )}
      </div>

      {!story && !busy && (
        <p className="text-xs text-muted-foreground">
          A narrative retelling of this simulation — generated once, deterministically cached for this seed.
        </p>
      )}

      {busy && (
        <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Weaving the story…
        </div>
      )}

      {story && !busy && (
        <article className="prose-narrative space-y-2 text-sm leading-relaxed text-foreground/90">
          {story.split(/\n{2,}/).map((para, i) => (
            <p key={i} className="animate-float-up">{para.trim()}</p>
          ))}
        </article>
      )}

      <div className="mt-3 flex gap-2">
        <Button
          onClick={() => generate(false)}
          disabled={busy}
          className="h-9 flex-1 rounded-xl gradient-rose text-primary-foreground text-xs"
        >
          {story ? "Re-open Story" : "Generate Story"}
        </Button>
        {story && (
          <Button
            variant="ghost"
            onClick={() => generate(true)}
            disabled={busy}
            className="glass h-9 rounded-xl text-xs"
            title="Regenerate (will overwrite cache)"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

function buildFallback(sim: Simulation): string {
  const r = sim.report;
  const agents = sim.agentIds
    .map((id) => NYX_AGENTS.find((a) => a.id === id)?.name ?? id)
    .slice(0, 4)
    .join(", ");
  if (!r) return `A simulation seeded by "${sim.seed}" unfolded across ${sim.rounds.length} rounds with ${agents}.`;
  return [
    `It began with a single seed: "${sim.seed}". ${agents} entered the room with their own certainties.`,
    `Across ${sim.rounds.length} rounds, the panel converged on ${r.winner}. Confidence settled at ${Math.round(r.confidence * 100)}%.`,
    `The best case: ${r.bestCase}`,
    `The worst case: ${r.worstCase}`,
    r.summary,
  ].join("\n\n");
}
