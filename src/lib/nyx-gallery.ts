// Community gallery — local-first storage of interesting seeds/scenarios.
// Stored in localStorage; can be exported/imported as JSON to share.
import type { Simulation } from "./nyx-types";

const KEY = "nyx_gallery_v1";

export interface GalleryEntry {
  id: string;                // unique entry id
  simId: string;             // original simulation id
  seed: string;              // seed text
  prngSeed?: number;
  title: string;             // user-provided or auto
  tagline?: string;          // 1-line summary
  winner: string;
  confidence: number;
  advanced: boolean;
  agentIds: string[];
  savedAt: number;
  tags: string[];            // e.g. ["cascade", "polarized"]
  story?: string;            // optional Story Mode prose
  simulation: Simulation;    // full snapshot for re-loading
}

export function listGallery(): GalleryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as GalleryEntry[];
    return Array.isArray(arr) ? arr.sort((a, b) => b.savedAt - a.savedAt) : [];
  } catch {
    return [];
  }
}

export function saveGalleryEntry(entry: GalleryEntry) {
  const all = listGallery().filter((e) => e.id !== entry.id);
  all.unshift(entry);
  localStorage.setItem(KEY, JSON.stringify(all.slice(0, 50)));
}

export function deleteGalleryEntry(id: string) {
  const all = listGallery().filter((e) => e.id !== id);
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function exportGallery(): string {
  return JSON.stringify(listGallery(), null, 2);
}

export function importGallery(json: string): number {
  try {
    const arr = JSON.parse(json) as GalleryEntry[];
    if (!Array.isArray(arr)) return 0;
    const existing = new Map(listGallery().map((e) => [e.id, e]));
    for (const e of arr) {
      if (e && typeof e.id === "string") existing.set(e.id, e);
    }
    const merged = [...existing.values()];
    localStorage.setItem(KEY, JSON.stringify(merged.slice(0, 50)));
    return arr.length;
  } catch {
    return 0;
  }
}

export function autoTagsFromSim(sim: Simulation): string[] {
  const tags: string[] = [];
  if (sim.advanced) tags.push("advanced");
  const rt = sim.runtime ?? {};
  const ids = Object.keys(rt);
  if (ids.some((id) => rt[id].cascade)) tags.push("cascade");
  const modes = ids.map((id) => rt[id].modeV5).filter(Boolean) as string[];
  if (modes.includes("collapse")) tags.push("collapse");
  if (modes.includes("growth")) tags.push("growth");
  if (modes.includes("recovery")) tags.push("recovery");
  if (modes.includes("fragile")) tags.push("fragile");
  if (sim.report) {
    if (sim.report.confidence >= 0.8) tags.push("high-confidence");
    if (sim.report.confidence < 0.4) tags.push("uncertain");
  }
  return [...new Set(tags)];
}

export function newGalleryId(): string {
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
