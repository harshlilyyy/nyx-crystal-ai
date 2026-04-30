import type { Simulation } from "./nyx-types";

const KEY = "nyx.simulations.v1";
const CURRENT = "nyx.current.v1";

function safeParse<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export function listSimulations(): Simulation[] {
  if (typeof window === "undefined") return [];
  return safeParse<Simulation[]>(localStorage.getItem(KEY), []);
}
export function saveSimulation(sim: Simulation) {
  if (typeof window === "undefined") return;
  const all = listSimulations();
  const idx = all.findIndex((s) => s.id === sim.id);
  if (idx >= 0) all[idx] = sim; else all.unshift(sim);
  localStorage.setItem(KEY, JSON.stringify(all.slice(0, 50)));
}
export function getSimulation(id: string): Simulation | undefined {
  return listSimulations().find((s) => s.id === id);
}
export function setCurrentId(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) localStorage.setItem(CURRENT, id);
  else localStorage.removeItem(CURRENT);
}
export function getCurrentId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(CURRENT);
}
export function getCurrent(): Simulation | undefined {
  const id = getCurrentId();
  return id ? getSimulation(id) : undefined;
}
export function newSimulationId() {
  return "sim_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}
