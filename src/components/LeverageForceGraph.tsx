import { lazy, Suspense, useMemo, useRef, useEffect, useState } from "react";
import type { Simulation, AgentRuntime } from "@/lib/nyx-types";
import { NYX_AGENTS } from "@/lib/nyx-agents";

// Client-only lazy import — react-force-graph-2d touches window/canvas
const ForceGraph2D = lazy(() => import("react-force-graph-2d"));

const constraintColor = (c?: string) => {
  if (c === "cap-limited") return "#C26B6B";
  if (c === "network-limited") return "#D6913B";
  if (c === "modulation-limited") return "#A77BC2";
  return "#9d9282";
};

export function LeverageForceGraph({
  sim,
  snap,
  lens,
  lensScale,
}: {
  sim: Simulation;
  snap: Record<string, AgentRuntime>;
  lens: string;
  lensScale: number;
}) {
  const a = sim.report?.assassin;
  const hasSens = !!a?.sensitivityScore;
  const ids = sim.agentIds ?? Object.keys(snap);
  const baseSens = (a?.sensitivityScore ?? 0.4) * lensScale;
  const [mounted, setMounted] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(280);
  useEffect(() => {
    setMounted(true);
    const update = () => { if (wrapRef.current) setW(wrapRef.current.clientWidth); };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const data = useMemo(() => {
    const nodes = ids.map((id) => {
      const rt = snap[id];
      const cls = rt?.dampingDiagnostics?.reputationCapTriggered || rt?.dampingDiagnostics?.opportunityCapTriggered
        ? "cap-limited"
        : a?.constraintClassification;
      const meta = NYX_AGENTS.find((x) => x.id === id);
      return {
        id,
        name: meta?.name ?? id,
        color: constraintColor(cls),
        val: hasSens ? 4 + baseSens * 10 : 6,
        cls: cls ?? "unclassified",
      };
    });
    const links: any[] = [];
    if (sim.graph?.edges?.length) {
      sim.graph.edges.forEach((e) => {
        if (ids.includes(e.source) && ids.includes(e.target)) {
          links.push({
            source: e.source,
            target: e.target,
            value: Math.abs(e.weight),
            pos: e.weight >= 0,
          });
        }
      });
    } else {
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++)
          links.push({ source: ids[i], target: ids[j], value: 0.4, pos: true });
    }
    return { nodes, links };
  }, [sim, snap, ids, hasSens, baseSens, a]);

  return (
    <section className="glass rounded-2xl p-3">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-base font-semibold">Leverage Map</h2>
        <span className="font-mono text-[9px] text-muted-foreground">{lens}</span>
      </header>
      {!hasSens && (
        <p className="mb-2 text-[10px] text-muted-foreground">
          Run Sensitivity Analysis to see counterfactual branches.
        </p>
      )}
      <div
        ref={wrapRef}
        className="overflow-hidden rounded-xl"
        style={{ background: "#1E1E1E", height: 240 }}
      >
        {mounted && (
          <Suspense fallback={<div className="grid h-full place-items-center text-[10px] text-white/60">loading graph…</div>}>
            <ForceGraph2D
              graphData={data}
              width={w}
              height={240}
              backgroundColor="#1E1E1E"
              nodeRelSize={4}
              nodeLabel={(n: any) => `${n.name} · ${n.cls}`}
              nodeCanvasObject={(node: any, ctx, gs) => {
                if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
                const safeGs = Number.isFinite(gs) && gs > 0 ? gs : 1;
                const rawVal = Number.isFinite(node.val) ? node.val : 6;
                const r = Math.max(3, rawVal / safeGs * 4 + 3);
                if (!Number.isFinite(r) || r <= 0) return;
                // glow
                const grad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r * 2.4);
                grad.addColorStop(0, `${node.color}cc`);
                grad.addColorStop(1, `${node.color}00`);
                ctx.fillStyle = grad;
                ctx.beginPath(); ctx.arc(node.x, node.y, r * 2.4, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = node.color;
                ctx.strokeStyle = "#FDFBF7";
                ctx.lineWidth = 1 / safeGs;
                ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.fillStyle = "#FDFBF7";
                ctx.font = `${10 / safeGs}px Inter, sans-serif`;
                ctx.textAlign = "center";
                ctx.fillText(node.name, node.x, node.y + r + 8 / safeGs);
              }}
              linkColor={(l: any) => (l.pos ? "rgba(110,160,120,0.55)" : "rgba(194,107,107,0.55)")}
              linkWidth={(l: any) => Math.max(0.4, l.value * 2)}
              linkDirectionalParticles={0}
              cooldownTicks={80}
              enableZoomInteraction
              enablePanInteraction
            />
          </Suspense>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-2 text-[8px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "#C26B6B" }} />cap</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "#D6913B" }} />network</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "#A77BC2" }} />modulation</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "#9d9282" }} />unclassified</span>
        {hasSens && <span className="ml-auto font-mono">S={baseSens.toFixed(2)}σ</span>}
      </div>
    </section>
  );
}
