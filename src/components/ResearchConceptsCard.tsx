// ResearchConceptsCard — Scientific tooltips (advanced-only).
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Concept {
  name: string;
  origin: string;
  role: string;
  why: string;
}

const CONCEPTS: Concept[] = [
  {
    name: "Active Inference",
    origin: "Karl Friston",
    role: "Agents minimize prediction error between expected and observed world.",
    why: "Explains anxiety spikes, lock-in, and adaptive learning slowdown.",
  },
  {
    name: "Cascade Theory",
    origin: "Mark Granovetter",
    role: "Heterogeneous thresholds determine when a contagion ignites.",
    why: "Tiny shifts can flip a stable system into mass withdrawal.",
  },
  {
    name: "Scale-Free Networks",
    origin: "Albert-László Barabási",
    role: "Influence graph follows preferential attachment — hubs dominate flow.",
    why: "Explains why a few well-connected agents amplify or absorb shocks.",
  },
  {
    name: "Shannon Entropy",
    origin: "Claude Shannon",
    role: "Quantifies narrative diversity across strategy buckets.",
    why: "Monoculture (H < 0.8) signals fragile consensus before collapse.",
  },
  {
    name: "Evolutionary Dynamics",
    origin: "Replicator Theory",
    role: "Mode probabilities drift toward strategies with above-average payoff.",
    why: "Captures how dominant playbooks crowd out alternatives over rounds.",
  },
  {
    name: "Homeostasis",
    origin: "Systems Biology",
    role: "Weak stabilizing forces kick in when trust collapses or inequality spikes.",
    why: "Models institutional self-correction without overriding emergence.",
  },
  {
    name: "Critical Transitions",
    origin: "Early Warning Signals (Scheffer)",
    role: "Rising variance and slowing recovery precede regime shifts.",
    why: "Lets us spot tipping points before they manifest.",
  },
];

export function ResearchConceptsCard() {
  return (
    <div className="glass rounded-[22px] p-4 space-y-2 font-sans">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
          Research · Foundational Concepts
        </div>
        <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-secondary-foreground">
          Hover for detail
        </span>
      </div>
      <TooltipProvider delayDuration={150}>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {CONCEPTS.map((c) => (
            <Tooltip key={c.name}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="rounded-xl bg-white/70 px-2 py-1.5 text-left text-[11px] font-medium text-foreground/85 transition hover:bg-white/90"
                >
                  {c.name}
                  <div className="text-[9px] font-mono text-muted-foreground">{c.origin}</div>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[240px] text-[11px] leading-snug">
                <div className="font-semibold">{c.name}</div>
                <div className="mt-1"><span className="font-semibold">Role in Nyx:</span> {c.role}</div>
                <div className="mt-1"><span className="font-semibold">Why it matters:</span> {c.why}</div>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
    </div>
  );
}
