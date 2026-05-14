// Architectural validation cards for the Neural Kernel Vault.
// Pure documentation — no engine changes. Gated behind Advanced Simulation
// by the parent page.
import { useEffect, useState } from "react";
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

interface Props {
  v8Active?: boolean;
  oasisEndpoint?: string;
}

const LARA_MAPPINGS: { layer: string; lara: string; nyx: string }[] = [
  {
    layer: "Perception",
    lara: "LARA Perception",
    nyx: "WORLD→MIND perception filter: perceived_event = raw_event × phenomenological_penetration × existence_value",
  },
  {
    layer: "Memory",
    lara: "LARA Memory",
    nyx: "Episodic buffer (Hippocampal Replay toggle) + persistent learning summaries",
  },
  {
    layer: "Preprocessor",
    lara: "LARA Preprocessor (habit / heuristics / evaluation)",
    nyx: "Mode transitions AVOID / RECOVER / EXECUTE / OPTIMIZE via sigmoid-softmax",
  },
  {
    layer: "Decision-making",
    lara: "LARA Decision-making",
    nyx: "MIND→WORLD intent emission (type + strength + target)",
  },
  {
    layer: "Postprocessor",
    lara: "LARA Postprocessor",
    nyx: "Outcome vector — reputation_mean, inequality, trust_proxy, centralization",
  },
];

export function KernelVaultArchitectureCards({ v8Active, oasisEndpoint }: Props) {
  const [oasisOk, setOasisOk] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!v8Active || !oasisEndpoint) {
      setOasisOk(null);
      return;
    }
    (async () => {
      try {
        const { checkOasisReachable } = await import("@/lib/nyx-v8");
        const ok = await checkOasisReachable(oasisEndpoint);
        if (!cancelled) setOasisOk(ok);
      } catch {
        if (!cancelled) setOasisOk(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [v8Active, oasisEndpoint]);

  return (
    <div className="glass rounded-[22px] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
          Neural Kernel Vault · Architecture
        </div>
        <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-secondary-foreground">
          Validated
        </span>
      </div>

      {/* LARA cognitive architecture mapping */}
      <div className="rounded-2xl bg-white/70 p-3">
        <div className="flex items-center gap-1 text-[11px] font-semibold">
          Cognitive Architecture · LARA mapping
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-[260px] text-[10px] leading-snug">
                LARA (Lightweight Architecture for boundedly Rational Agents) bridges ABM
                frameworks and full cognitive architectures. Each LARA component maps cleanly
                onto a Nyx layer, grounding Nyx in established cognitive psychology.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="mt-2 space-y-1.5">
          <TooltipProvider delayDuration={150}>
            {LARA_MAPPINGS.map((m) => (
              <Tooltip key={m.layer}>
                <TooltipTrigger asChild>
                  <div className="flex cursor-help items-center justify-between gap-2 rounded-xl bg-secondary/40 px-2 py-1 text-[10px]">
                    <span className="font-mono font-semibold">{m.layer}</span>
                    <span className="truncate text-muted-foreground">{m.lara}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-[280px] text-[10px] leading-snug">
                  <div className="font-semibold">{m.lara}</div>
                  <div className="mt-1 text-muted-foreground">→ {m.nyx}</div>
                </TooltipContent>
              </Tooltip>
            ))}
          </TooltipProvider>
        </div>
      </div>

      {/* Scale Ceiling */}
      <div className="rounded-2xl bg-white/70 p-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold">Scale Ceiling · OASIS / AgentSociety</div>
          {v8Active && oasisEndpoint && (
            <span
              className={
                "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider " +
                (oasisOk === true
                  ? "bg-[oklch(0.9_0.05_180)] text-[oklch(0.4_0.06_180)]"
                  : oasisOk === false
                    ? "bg-[oklch(0.93_0.06_25)] text-primary"
                    : "bg-secondary/60 text-secondary-foreground")
              }
            >
              {oasisOk === true ? "OASIS reachable" : oasisOk === false ? "OASIS offline" : "checking…"}
            </span>
          )}
        </div>
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
          Current agent ceiling: <span className="font-mono font-semibold">50</span> (browser-based
          TypeScript loop). Architecture supports <span className="font-mono font-semibold">1,000+</span>{" "}
          agents when connected to an OASIS or AgentSociety backend (v8 toggle). Nyx remains the
          cognitive engine; the social-world layer is delegated cleanly.
        </p>
      </div>

      {/* Multi-Level Simulation (v8 experimental placeholder) */}
      <div className="rounded-2xl bg-white/70 p-3">
        <div className="text-[11px] font-semibold">Multi-Level Simulation · v12+ horizon</div>
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
          NetLogo LevelSpace proves recursive agent architectures (simulations within simulations)
          are feasible with standardized programming primitives. Nyx's v12+ Society-of-Thought goal
          — each agent's mind as a miniature Nyx simulation — follows this validated pattern.
        </p>
      </div>

      {/* Performance Horizon */}
      <div className="rounded-2xl bg-white/70 p-3">
        <div className="text-[11px] font-semibold">Performance Horizon · BioDynaMo (PPoPP 2023)</div>
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
          BioDynaMo simulated <span className="font-mono font-semibold">1.72 billion</span> agents on
          a single server using NUMA-aware iteration, space-filling-curve sorting, and custom heap
          allocation. Nyx prioritizes cognitive depth (~50 agents × 10 psychological variables); the
          same architectural pattern scales to production loads when needed.
        </p>
      </div>
    </div>
  );
}
