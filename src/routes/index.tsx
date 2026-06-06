import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { listSimulations, newSimulationId, saveSimulation, setCurrentId } from "@/lib/nyx-store";
import type { Simulation } from "@/lib/nyx-types";
import { Plus, ChevronRight, Sparkles } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Nyx — Home" },
      { name: "description", content: "Start a new strategic simulation or resume a recent one." },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const nav = useNavigate();
  const [recents, setRecents] = useState<Simulation[]>([]);
  useEffect(() => { setRecents(listSimulations().slice(0, 5)); }, []);

  function startNew() {
    const sim: Simulation = {
      id: newSimulationId(),
      seed: "",
      ontology: [],
      graph: { nodes: [], edges: [] },
      agentIds: [],
      rounds: [],
      createdAt: Date.now(),
      status: "draft",
    };
    saveSimulation(sim);
    setCurrentId(sim.id);
    nav({ to: "/setup" });
  }

  function open(id: string) {
    setCurrentId(id);
    const s = listSimulations().find((x) => x.id === id);
    nav({ to: s?.report ? "/report" : "/simulation" });
  }

  return (
    <PageShell>
      <div className="pb-4 pt-4 text-center">
        <div className="label-eyebrow mb-3">For a heart of gold</div>
        <h1 className="font-display text-7xl font-semibold tracking-tight leading-none text-foreground">
          NYX
        </h1>
        <div className="mx-auto mt-3 h-px w-16" style={{ background: "#C8A97E" }} />
        <p className="mx-auto mt-4 max-w-xs text-sm italic text-muted-foreground text-balance font-display">
          Strategic simulation, beautifully simple.
        </p>
      </div>

      <button
        onClick={startNew}
        className="group relative flex w-full items-center justify-between gap-3 rounded-[28px] gradient-rose px-6 py-5 text-primary-foreground shadow-[var(--shadow-soft)] transition-transform active:scale-[0.98]"
      >
        <span className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/25">
            <Plus className="h-5 w-5" />
          </span>
          <span className="text-left">
            <span className="block font-display text-lg font-semibold">New Simulation</span>
            <span className="block text-xs opacity-80">Begin from a single seed</span>
          </span>
        </span>
        <ChevronRight className="h-5 w-5 opacity-80 transition-transform group-hover:translate-x-0.5" />
      </button>

      <section>
        <h2 className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Recent
        </h2>
        {recents.length === 0 ? (
          <div className="glass rounded-[24px] px-5 py-10 text-center text-sm text-muted-foreground">
            Your simulations will appear here.
          </div>
        ) : (
          <ul className="space-y-2">
            {recents.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => open(s.id)}
                  className="glass flex w-full items-center justify-between gap-3 rounded-[22px] px-4 py-3 text-left transition-colors hover:bg-white/85"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{s.seed || "Untitled simulation"}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(s.createdAt).toLocaleDateString()} · {s.status}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="pt-2 text-center">
        <Link to="/agents" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
          Browse the agent roster →
        </Link>
      </div>
    </PageShell>
  );
}
