// Community gallery — saved scenarios/seeds. Local-first with JSON export/import.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { Download, Upload, Trash2, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  listGallery, deleteGalleryEntry, exportGallery, importGallery, type GalleryEntry,
} from "@/lib/nyx-gallery";
import { saveSimulation, setCurrentId } from "@/lib/nyx-store";

export const Route = createFileRoute("/gallery")({
  head: () => ({
    meta: [
      { title: "Nyx — Community Gallery" },
      { name: "description", content: "Browse interesting Nyx simulation seeds and scenarios." },
    ],
  }),
  component: GalleryPage,
});

function GalleryPage() {
  const nav = useNavigate();
  const [entries, setEntries] = useState<GalleryEntry[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  function refresh() { setEntries(listGallery()); }
  useEffect(refresh, []);

  function openEntry(e: GalleryEntry) {
    // Clone the snapshot into the active simulations list and route to its proper page.
    saveSimulation(e.simulation);
    setCurrentId(e.simulation.id);
    nav({ to: e.simulation.report ? "/report" : "/simulation" });
  }

  function onDelete(id: string) {
    deleteGalleryEntry(id);
    refresh();
    toast.success("Removed from gallery");
  }

  function onExport() {
    const blob = new Blob([exportGallery()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `nyx-gallery-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  function onImportClick() { fileRef.current?.click(); }

  async function onImportFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const count = importGallery(text);
    if (count > 0) {
      toast.success(`Imported ${count} entr${count === 1 ? "y" : "ies"}`);
      refresh();
    } else {
      toast.error("Could not import file");
    }
    ev.target.value = "";
  }

  return (
    <PageShell title="Gallery" subtitle="Community scenarios">
      <div className="glass-strong rounded-[24px] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
              <Sparkles className="mr-1 inline h-3 w-3" />
              Curated Seeds
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Save interesting simulations from the Report page. Export to share, import to explore others' scenarios.
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="ghost" className="glass h-9 rounded-xl text-xs flex-1" onClick={onExport} disabled={entries.length === 0}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export
          </Button>
          <Button variant="ghost" className="glass h-9 rounded-xl text-xs flex-1" onClick={onImportClick}>
            <Upload className="mr-1.5 h-3.5 w-3.5" /> Import
          </Button>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={onImportFile} />
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="glass rounded-[22px] px-5 py-10 text-center text-sm text-muted-foreground">
          No saved scenarios yet. Finish a simulation, open the Report, and tap "Save to Gallery".
        </div>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="glass rounded-[22px] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-sm">{e.title}</div>
                  {e.tagline && (
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{e.tagline}</div>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="rounded-full bg-secondary/60 px-2 py-0.5 font-mono text-secondary-foreground">
                      {Math.round(e.confidence * 100)}% · {e.winner.slice(0, 28)}
                    </span>
                    {typeof e.prngSeed === "number" && (
                      <span className="rounded-full bg-white/60 px-2 py-0.5 font-mono text-muted-foreground">
                        seed {e.prngSeed}
                      </span>
                    )}
                    {e.tags.slice(0, 4).map((t) => (
                      <span key={t} className="rounded-full bg-[oklch(0.94_0.04_70)] px-2 py-0.5 text-primary">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1.5">
                  <button
                    onClick={() => openEntry(e)}
                    className="flex h-8 w-8 items-center justify-center rounded-full gradient-rose text-primary-foreground"
                    aria-label="Open"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => onDelete(e.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/70 text-muted-foreground hover:text-destructive"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
