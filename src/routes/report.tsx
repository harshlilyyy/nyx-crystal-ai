import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { getCurrent, saveSimulation } from "@/lib/nyx-store";
import { NYX_AGENTS } from "@/lib/nyx-agents";
import type { Simulation } from "@/lib/nyx-types";
import { Copy, Download, Share2, Sparkles, Send, ChevronDown, ChevronUp, Loader2, BookmarkPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { StoryModePanel } from "@/components/StoryModePanel";
import { saveGalleryEntry, autoTagsFromSim, newGalleryId, listGallery } from "@/lib/nyx-gallery";

export const Route = createFileRoute("/report")({
  head: () => ({
    meta: [
      { title: "Nyx — Strategic Forecast" },
      { name: "description", content: "Read the final Strategic Forecast Report and chat with agents." },
    ],
  }),
  component: ReportPage,
});

function ReportPage() {
  const nav = useNavigate();
  const [sim, setSim] = useState<Simulation | undefined>();
  const [storyText, setStoryText] = useState<string>("");

  useEffect(() => {
    const s = getCurrent();
    if (!s || !s.report) { nav({ to: "/" }); return; }
    setSim(s);
  }, [nav]);

  if (!sim?.report) return <PageShell title="Report" subtitle="No report yet"><div /></PageShell>;
  const r = sim.report;

  function buildMd() {
    return `# Nyx Strategic Forecast\n\n**Winner:** ${r.winner}\n**Confidence:** ${Math.round(r.confidence * 100)}%\n\n## Summary\n${r.summary}\n\n## Best Case\n${r.bestCase}\n\n## Worst Case\n${r.worstCase}\n\n## Hidden Failure Points\n${r.hiddenFailures.map((h) => "- " + h).join("\n")}\n\n## Timeline\n${r.timeline.map((t) => `- **${t.period}** — ${t.event}`).join("\n")}\n`;
  }

  async function copy() {
    await navigator.clipboard.writeText(buildMd());
    toast.success("Report copied");
  }
  function download() {
    const blob = new Blob([buildMd()], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `nyx-${sim!.id}.md`; a.click();
    URL.revokeObjectURL(url);
  }
  function shareX() {
    const text = encodeURIComponent(`Nyx forecast: ${r.winner} — ${Math.round(r.confidence * 100)}% confidence.`);
    window.open(`https://twitter.com/intent/tweet?text=${text}`, "_blank");
  }

  return (
    <PageShell title="Forecast" subtitle="Strategic Report">
      {/* Verdict capsule */}
      <div className="glass-strong rounded-[28px] p-6 text-center">
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">Winner</div>
        <h2 className="mt-1 font-display text-2xl font-semibold text-balance">{r.winner}</h2>
        <ConfidenceGauge value={r.confidence} />
        {sim.advanced && r.confidenceBreakdown && (
          <ConfidenceBreakdownBars breakdown={r.confidenceBreakdown} />
        )}
        {sim.advanced && typeof sim.prngSeed === "number" && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/60 px-3 py-1 font-mono text-[10px] text-muted-foreground">
            <span className="font-semibold uppercase tracking-wider text-primary">seed</span>
            <span>{sim.prngSeed}</span>
            <button
              onClick={() => { navigator.clipboard.writeText(String(sim.prngSeed)); toast.success("Seed copied"); }}
              className="rounded-full bg-secondary/60 px-2 py-0.5 text-[9px] uppercase tracking-wider text-secondary-foreground"
            >
              copy
            </button>
          </div>
        )}
      </div>

      {/* Assassin's Report (advanced only) — sits BEFORE the regular verdict sections */}
      {sim.advanced && r.assassin && (
        <div className="glass rounded-[24px] p-4 ring-1 ring-[oklch(0.92_0.05_25)]">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
              🦢 Assassin's Report
            </div>
            {typeof r.assassin.probability === "number" && (
              <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-[9px] font-mono text-secondary-foreground">
                p = {Math.round(r.assassin.probability * 100)}%
              </span>
            )}
          </div>
          <AssassinField label="Assumption" value={r.assassin.assumption} />
          <AssassinField label="Why fragile" value={r.assassin.whyFragile} />
          <AssassinField label="Break scenario" value={r.assassin.breakScenario} />
          <AssassinField label="Impact if broken" value={r.assassin.impactIfBroken} />
        </div>
      )}

      {/* Scores */}
      <div className="glass rounded-[22px] p-4">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Scores</div>
        <div className="space-y-2.5">
          {r.scores.map((s, i) => (
            <div key={i}>
              <div className="mb-0.5 flex justify-between text-xs">
                <span>{s.label}</span><span className="font-mono">{Math.round(s.value * 100)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full gradient-rose" style={{ width: `${s.value * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <Section title="Summary" defaultOpen><p className="text-sm leading-relaxed">{r.summary}</p></Section>
      <Section title="Best Case"><p className="text-sm leading-relaxed">{r.bestCase}</p></Section>
      <Section title="Worst Case"><p className="text-sm leading-relaxed">{r.worstCase}</p></Section>
      <Section title="Hidden Failure Points">
        <ul className="space-y-1.5 text-sm">
          {r.hiddenFailures.map((h, i) => <li key={i} className="flex gap-2"><span className="text-primary">·</span>{h}</li>)}
        </ul>
      </Section>
      <Section title="Timeline">
        <ol className="space-y-2">
          {r.timeline.map((t, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-secondary-foreground">{t.period}</span>
              <span className="flex-1 text-sm">{t.event}</span>
            </li>
          ))}
        </ol>
      </Section>

      {/* Loop analysis (advanced sims only) */}
      {r.loopAnalysis && (
        <Section title="Feedback Loops" defaultOpen>
          <div className="space-y-3">
            {r.loopAnalysis.loops.length === 0 && (
              <p className="text-xs text-muted-foreground">No compounding loops detected.</p>
            )}
            {r.loopAnalysis.loops.map((l, i) => {
              const a = NYX_AGENTS.find((x) => x.id === l.agentId);
              const isFailure = l.pattern.startsWith("failure");
              return (
                <div key={i} className="rounded-2xl bg-white/70 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold flex items-center gap-1.5">
                      <span>{a?.avatar}</span>{a?.name ?? l.agentId}
                    </span>
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                      isFailure ? "bg-[oklch(0.92_0.05_25)] text-primary" : "bg-[oklch(0.9_0.05_180)] text-[oklch(0.4_0.06_180)]"
                    )}>{l.pattern}</span>
                  </div>
                  <p className="mt-1 text-xs leading-snug text-muted-foreground">{l.impact}</p>
                  <div className="mt-1 text-[10px] font-mono text-muted-foreground">
                    rounds: {l.rounds.map((n) => n + 1).join(" → ")}
                  </div>
                </div>
              );
            })}

            {r.loopAnalysis.tippingPoints.length > 0 && (
              <div className="rounded-2xl bg-[oklch(0.95_0.03_25)] p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">Tipping points</div>
                <ul className="mt-1 space-y-1 text-xs">
                  {r.loopAnalysis.tippingPoints.map((t, i) => (
                    <li key={i}>· {t.threshold} <span className="text-muted-foreground">(round {t.round + 1})</span></li>
                  ))}
                </ul>
              </div>
            )}

            {r.loopAnalysis.compoundEffects.length > 0 && (
              <ul className="space-y-1 text-xs">
                {r.loopAnalysis.compoundEffects.map((c, i) => (
                  <li key={i} className="flex gap-2"><span className="text-primary">·</span>{c}</li>
                ))}
              </ul>
            )}
          </div>
        </Section>
      )}

      {/* v8 Game Theory expander (advanced + flag + result present) */}
      {sim.advanced && sim.v8Flags?.gameTheory && sim.gameTheory && (
        <Section title="Game Theory" defaultOpen>
          <div className="space-y-2 text-xs">
            {sim.gameTheory.summary && <p className="leading-relaxed">{sim.gameTheory.summary}</p>}
            {sim.gameTheory.nashEquilibria.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">Nash equilibria</div>
                <ul className="mt-0.5 space-y-0.5">{sim.gameTheory.nashEquilibria.map((n, i) => <li key={i}>· {n}</li>)}</ul>
              </div>
            )}
            {sim.gameTheory.dominantStrategies.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">Dominant strategies</div>
                <ul className="mt-0.5 space-y-0.5">
                  {sim.gameTheory.dominantStrategies.slice(0, 3).map((d, i) => {
                    const a = NYX_AGENTS.find((x) => x.id === d.agentId);
                    return <li key={i}>· <span className="font-semibold">{a?.name ?? d.agentId}</span>: {d.strategy}</li>;
                  })}
                </ul>
              </div>
            )}
            {sim.gameTheory.paretoFrontier.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">Pareto frontier</div>
                <ul className="mt-0.5 space-y-0.5">{sim.gameTheory.paretoFrontier.map((p, i) => <li key={i}>· {p}</li>)}</ul>
              </div>
            )}
            {sim.gameTheory.rationalityGap && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">Rationality gap</div>
                <p className="mt-0.5 leading-relaxed">{sim.gameTheory.rationalityGap}</p>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Story Mode — seeded narrative retelling */}
      <StoryModePanel sim={sim} onStoryReady={(s) => setStoryText(s)} />

      {/* Save to community gallery */}
      <SaveToGalleryCard sim={sim} story={storyText} />

      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={copy} className="glass h-11 rounded-2xl"><Copy className="mr-2 h-4 w-4" />Copy</Button>
        <Button variant="ghost" onClick={shareX} className="glass h-11 rounded-2xl"><Share2 className="mr-2 h-4 w-4" />Share</Button>
        <Button variant="ghost" onClick={download} className="glass h-11 rounded-2xl"><Download className="mr-2 h-4 w-4" />Download</Button>
        <Button onClick={() => toast.success("🎉 Strategy locked in")} className="h-11 rounded-2xl gradient-rose text-primary-foreground"><Sparkles className="mr-2 h-4 w-4" />Celebrate</Button>
      </div>

      <ChatPanel sim={sim} onSimChange={setSim} />
    </PageShell>
  );
}

function SaveToGalleryCard({ sim, story }: { sim: Simulation; story: string }) {
  const [title, setTitle] = useState<string>(sim.seed.slice(0, 60) || "Untitled scenario");
  const [tagline, setTagline] = useState<string>(sim.report?.summary?.slice(0, 140) ?? "");
  const [saved, setSaved] = useState<boolean>(false);

  useEffect(() => {
    const exists = listGallery().some((g) => g.simId === sim.id);
    setSaved(exists);
  }, [sim.id]);

  function save() {
    if (!sim.report) return;
    const tags = autoTagsFromSim(sim);
    saveGalleryEntry({
      id: newGalleryId(),
      simId: sim.id,
      seed: sim.seed,
      prngSeed: sim.prngSeed,
      title: title.trim() || "Untitled scenario",
      tagline: tagline.trim(),
      winner: sim.report.winner,
      confidence: sim.report.confidence,
      advanced: !!sim.advanced,
      agentIds: sim.agentIds,
      savedAt: Date.now(),
      tags,
      story: story || undefined,
      simulation: sim,
    });
    setSaved(true);
    toast.success("Saved to gallery");
  }

  return (
    <div className="glass rounded-[22px] p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary flex items-center gap-1.5">
          <BookmarkPlus className="h-3 w-3" /> Save to Gallery
        </div>
        {saved && <span className="text-[10px] text-muted-foreground">already saved</span>}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="w-full rounded-xl bg-white/70 px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary/30"
      />
      <input
        value={tagline}
        onChange={(e) => setTagline(e.target.value)}
        placeholder="One-line tagline (optional)"
        className="mt-2 w-full rounded-xl bg-white/70 px-3 py-2 text-xs outline-none ring-1 ring-border focus:ring-primary/30"
        maxLength={140}
      />
      <Button onClick={save} className="mt-3 h-9 w-full rounded-xl gradient-rose text-primary-foreground text-xs">
        <BookmarkPlus className="mr-1.5 h-3.5 w-3.5" /> {saved ? "Save Another Copy" : "Save Scenario"}
      </Button>
    </div>
  );
}

function ReportPageStoryHook() { return null; /* placeholder, unused */ }


function ConfidenceGauge({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value));
  const r = 52, c = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto mt-3 h-[120px] w-[120px]">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} stroke="oklch(0.92 0.02 70)" strokeWidth="10" fill="none" />
        <circle cx="60" cy="60" r={r} stroke="url(#g)" strokeWidth="10" fill="none"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="oklch(0.78 0.07 30)" />
            <stop offset="100%" stopColor="oklch(0.7 0.07 20)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-2xl font-semibold">{Math.round(pct * 100)}%</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">confidence</span>
      </div>
    </div>
  );
}

function ConfidenceBreakdownBars({ breakdown }: { breakdown: NonNullable<Simulation["report"]>["confidenceBreakdown"] }) {
  if (!breakdown) return null;
  const dims: { key: keyof NonNullable<typeof breakdown>; label: string }[] = [
    { key: "structuralFeasibility", label: "Feasibility" },
    { key: "stakeholderAlignment", label: "Alignment" },
    { key: "riskExposure", label: "Risk (safe)" },
    { key: "evidenceStrength", label: "Evidence" },
  ];
  return (
    <div className="mt-4 space-y-1.5 text-left">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        Confidence Rubric{breakdown.framework ? ` · ${breakdown.framework}` : ""}
      </div>
      {dims.map((d) => {
        const raw = (breakdown as unknown as Record<string, number>)[d.key as string] ?? 0;
        const pct = Math.round((raw / 10) * 100);
        const just = breakdown.justifications?.[d.key as keyof NonNullable<typeof breakdown.justifications>];
        return (
          <div key={d.key as string}>
            <div className="flex items-center justify-between text-[10px]">
              <span>{d.label}</span>
              <span className="font-mono tabular-nums">{raw.toFixed(1)}/10</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full gradient-rose" style={{ width: `${pct}%` }} />
            </div>
            {just && <div className="mt-0.5 text-[9px] leading-snug text-muted-foreground">{just}</div>}
          </div>
        );
      })}
    </div>
  );
}

function AssassinField({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <p className="mt-0.5 text-sm leading-relaxed">{value}</p>
    </div>
  );
}

function Section({ title, children, defaultOpen }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="glass rounded-[22px]">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">{title}</span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function ChatPanel({ sim, onSimChange }: { sim: Simulation; onSimChange: (s: Simulation) => void }) {
  const [agentId, setAgentId] = useState("vera");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; agentId?: string; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const agentChoices = ["vera", ...sim.agentIds.filter((a) => a !== "vera")];

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send() {
    if (!input.trim() || busy) return;
    const userMsg = { role: "user" as const, content: input };
    setMessages((p) => [...p, userMsg]);
    setInput(""); setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("nyx-ai", {
        body: {
          task: "chat", agentId, seed: sim.seed, report: sim.report,
          history: [...messages, userMsg].slice(-12),
        },
      });
      if (error) throw error;
      setMessages((p) => [...p, { role: "assistant", agentId, content: data.reply }]);
      onSimChange(sim);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Chat failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="glass rounded-[24px] p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">Chat</div>
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="rounded-full bg-white/70 px-3 py-1 text-xs outline-none">
          {agentChoices.map((id) => {
            const a = NYX_AGENTS.find((x) => x.id === id)!;
            return <option key={id} value={id}>{a.avatar} {a.name}</option>;
          })}
        </select>
      </div>
      <div className="mb-3 max-h-[260px] min-h-[80px] space-y-2 overflow-y-auto">
        {messages.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">Ask a follow-up question…</p>}
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn(
              "max-w-[80%] rounded-2xl px-3 py-2 text-sm animate-float-up",
              m.role === "user" ? "gradient-rose text-primary-foreground rounded-br-sm" : "bg-white/85 rounded-bl-sm"
            )}>
              {m.role === "assistant" && (
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  {NYX_AGENTS.find((a) => a.id === m.agentId)?.name}
                </div>
              )}
              <div>{m.content}</div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Message…"
          className="flex-1 rounded-2xl bg-white/70 px-4 py-2.5 text-sm outline-none ring-1 ring-border focus:ring-primary/40"
        />
        <button onClick={send} disabled={busy} className="flex h-10 w-10 items-center justify-center rounded-2xl gradient-rose text-primary-foreground">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
