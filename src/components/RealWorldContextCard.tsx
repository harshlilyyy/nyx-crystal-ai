import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChevronDown, Globe2, Loader2, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { saveSimulation } from "@/lib/nyx-store";
import { enrichWithRealWorld, EnrichAuthError } from "@/lib/nyx-enrich";
import type { Simulation } from "@/lib/nyx-types";

const TYPE_COLOR: Record<string, string> = {
  person: "bg-rose-100 text-rose-700",
  organization: "bg-amber-100 text-amber-700",
  event: "bg-violet-100 text-violet-700",
  concept: "bg-teal-100 text-teal-700",
  location: "bg-sky-100 text-sky-700",
};

export function RealWorldContextCard({
  sim,
  setSim,
}: {
  sim: Simulation;
  setSim: (s: Simulation) => void;
}) {
  const [open, setOpen] = useState(!!sim.realWorldContext);
  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState("");
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ctx = sim.realWorldContext;

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= 5) break;
      if (f.size > 8 * 1024 * 1024) {
        toast.error(`${f.name} is too large (max 8MB).`);
        continue;
      }
      next.push(f);
    }
    setFiles(next);
  }

  async function enrich() {
    if (!files.length && !pasted.trim()) {
      toast.error("Add a file or paste some text first.");
      return;
    }
    setLoading(true);
    try {
      const realWorldContext = await enrichWithRealWorld({ files, pastedText: pasted });
      // Assign Evidence Keeper to the first selected agent if any.
      if (sim.agentIds.length > 0 && !realWorldContext.evidenceKeeperId) {
        realWorldContext.evidenceKeeperId = sim.agentIds[0];
      }
      const next: Simulation = { ...sim, realWorldContext };
      setSim(next);
      saveSimulation(next);
      setFiles([]);
      setPasted("");
      if (fileRef.current) fileRef.current.value = "";
      toast.success(
        `Enriched with ${realWorldContext.entities.length} entities from real-world context.`,
      );
    } catch (e: unknown) {
      if (e instanceof EnrichAuthError) {
        toast.error("Sign in to use real-world enrichment.");
      } else {
        toast.error(e instanceof Error ? e.message : "Enrichment failed");
      }
    } finally {
      setLoading(false);
    }
  }

  function clearContext() {
    const next: Simulation = { ...sim };
    delete next.realWorldContext;
    setSim(next);
    saveSimulation(next);
    toast.success("Real-world context cleared.");
  }

  return (
    <div className="glass rounded-[22px] p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3"
        aria-expanded={open}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-secondary/60">
            <Globe2 className="h-4 w-4 text-primary" />
          </span>
          <div className="text-left">
            <div className="text-sm font-medium">🌐 Real-World Context</div>
            <div className="text-[11px] leading-snug text-muted-foreground">
              {ctx
                ? `${ctx.entities.length} entities · ${ctx.sources.length} source(s)`
                : "Inject PDFs or articles as evidence agents can debate."}
            </div>
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="rounded-2xl bg-white/50 p-3">
            <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Upload PDFs or .txt
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt,application/pdf,text/plain"
              multiple
              onChange={(e) => addFiles(e.target.files)}
              className="hidden"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-xl bg-white/70 text-xs"
            >
              <Upload className="mr-1 h-3 w-3" /> Choose files
            </Button>
            {files.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {files.map((f, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[10px]"
                  >
                    {f.name}
                    <button
                      type="button"
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-primary"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-white/50 p-3">
            <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Paste news snippet or article text
            </label>
            <Textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="Paste an article excerpt, briefing, or news summary…"
              className="min-h-[100px] resize-none rounded-xl border-0 bg-white/80 text-xs focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </div>

          <Button
            type="button"
            onClick={enrich}
            disabled={loading || (!files.length && !pasted.trim())}
            className="h-10 w-full rounded-2xl gradient-rose text-primary-foreground shadow-[var(--shadow-soft)]"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Enriching with real-world context…
              </>
            ) : (
              "Fetch & Enrich"
            )}
          </Button>

          {ctx && (
            <div className="rounded-2xl bg-white/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Injected context
                </div>
                <button
                  type="button"
                  onClick={clearContext}
                  className="rounded-full p-1 text-muted-foreground hover:bg-white"
                  aria-label="Clear context"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              {ctx.summary && (
                <p className="mt-1 text-[12px] leading-snug">{ctx.summary}</p>
              )}
              {ctx.claim && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  <span className="font-semibold">Claim:</span> {ctx.claim}
                </p>
              )}
              {ctx.risk_factor && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  <span className="font-semibold">Risk:</span> {ctx.risk_factor}
                </p>
              )}
              {ctx.entities.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {ctx.entities.map((e, i) => (
                    <span
                      key={i}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${TYPE_COLOR[e.type] ?? "bg-secondary text-secondary-foreground"}`}
                      title={e.type}
                    >
                      {e.name}
                    </span>
                  ))}
                </div>
              )}
              {ctx.sources.length > 0 && (
                <div className="mt-2 text-[10px] text-muted-foreground">
                  Sources: {ctx.sources.join(", ")}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
