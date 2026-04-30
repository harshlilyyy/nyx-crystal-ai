import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { NYX_AGENTS, PRESETS } from "@/lib/nyx-agents";
import { getCurrent, saveSimulation } from "@/lib/nyx-store";
import type { Simulation } from "@/lib/nyx-types";
import { Check, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/agents")({
  head: () => ({
    meta: [
      { title: "Nyx — Agents" },
      { name: "description", content: "Pick the agent panel that will run your simulation." },
    ],
  }),
  component: AgentsPage,
});

function AgentsPage() {
  const nav = useNavigate();
  const [sim, setSim] = useState<Simulation | undefined>();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    const s = getCurrent();
    if (s) {
      setSim(s);
      setSelected(new Set(s.agentIds.length ? s.agentIds : PRESETS.startup.agentIds));
    }
  }, []);

  function toggle(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }

  function applyPreset(key: keyof typeof PRESETS) {
    setSelected(new Set(PRESETS[key].agentIds));
  }

  function save() {
    if (!sim) return;
    if (selected.size < 2) { toast.error("Pick at least 2 agents"); return; }
    saveSimulation({ ...sim, agentIds: Array.from(selected), status: "agents" });
    nav({ to: "/simulation" });
  }

  return (
    <PageShell title="Agents" subtitle={`${selected.size} selected`}>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((k) => (
          <button
            key={k}
            onClick={() => applyPreset(k)}
            className="glass shrink-0 rounded-full px-4 py-2 text-xs font-medium hover:bg-white/85"
          >
            {PRESETS[k].label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {NYX_AGENTS.map((a) => {
          const on = selected.has(a.id);
          return (
            <button
              key={a.id}
              onClick={() => toggle(a.id)}
              className={cn(
                "glass relative flex flex-col items-start rounded-[22px] p-4 text-left transition-all",
                on && "ring-2 ring-primary/60 bg-white/85"
              )}
            >
              {on && (
                <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full gradient-rose text-primary-foreground">
                  <Check className="h-3 w-3" />
                </span>
              )}
              <span className="text-2xl">{a.avatar}</span>
              <span className="mt-2 font-display text-base font-semibold">{a.name}</span>
              <span className="text-[11px] uppercase tracking-wider text-primary">{a.role}</span>
              <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.personality}</span>
            </button>
          );
        })}
      </div>

      <Button
        onClick={save}
        className="h-12 w-full rounded-2xl gradient-rose text-primary-foreground shadow-[var(--shadow-soft)]"
      >
        Save & Go to Simulation <ArrowRight className="ml-1 h-4 w-4" />
      </Button>
    </PageShell>
  );
}
