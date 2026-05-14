// useNyxKernel — loads the Python Nyx kernel via Pyodide (singleton) and
// exposes a typed runSimulation() to React components.
//
// Pyodide itself is loaded by the <script src=".../pyodide.js"> tag injected
// from src/routes/__root.tsx, exposing window.loadPyodide.

import { useEffect, useState } from "react";

// ===== Types =====
export interface ScenarioAgent {
  name: string;
  role: string;
  personality: string;
  initial_state?: Record<string, number>;
  emotional_anchor?: { name: string; intensity: number; valence: number } | null;
}

export interface Scenario {
  agents: ScenarioAgent[];
  influence_network: Record<string, Record<string, number>>;
}

export interface AgentSnapshot {
  name: string;
  role: string;
  mode: string;
  self_worth: number;
  anxiety: number;
  consistency: number;
  momentum: number;
  reputation: number;
  opportunity_access: number;
  fragility_index: number;
  lock_in: number;
  learning_rate: number;
  energy: number;
  contradiction_score: number;
  cascade_active: boolean;
  blocked: boolean;
}

export interface WorldSnapshot {
  reputation_mean: number;
  inequality: number;
  trust_proxy: number;
  centralization: number;
}

export interface RoundState {
  round: number;
  agents: Record<string, AgentSnapshot>;
  world: WorldSnapshot;
}

export interface OutcomeVector {
  reputation_mean: number;
  inequality: number;
  trust_proxy: number;
  centralization: number;
  // Mesa 3.4 universal simulation time — single source of truth, deterministic
  // per step. Non-persistent; populated in-memory after the kernel returns.
  simulation_time?: number;
}

export interface SimulationResult {
  stateHistory: RoundState[];
  outcomeVector: OutcomeVector;
  seed: number;
}

// ===== Pyodide singleton =====
type PyodideAPI = {
  runPythonAsync: (code: string) => Promise<unknown>;
  runPython: (code: string) => unknown;
  globals: {
    set: (key: string, value: unknown) => void;
    get: (key: string) => unknown;
  };
};

declare global {
  interface Window {
    loadPyodide?: (opts?: { indexURL?: string }) => Promise<PyodideAPI>;
    __nyxPyodide?: Promise<PyodideAPI>;
  }
}

const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/";

async function waitForLoader(timeoutMs = 20000): Promise<void> {
  if (typeof window === "undefined") throw new Error("Pyodide requires a browser");
  if (window.loadPyodide) return;
  const start = Date.now();
  while (!window.loadPyodide) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Pyodide loader script did not load in time");
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function getPyodide(): Promise<PyodideAPI> {
  if (typeof window === "undefined") throw new Error("SSR: no Pyodide");
  if (window.__nyxPyodide) return window.__nyxPyodide;

  window.__nyxPyodide = (async () => {
    await waitForLoader();
    const py = await window.loadPyodide!({ indexURL: PYODIDE_INDEX_URL });
    // Fetch and load the kernel source once
    const res = await fetch("/nyx_kernel.py");
    if (!res.ok) throw new Error(`Failed to fetch /nyx_kernel.py: ${res.status}`);
    const src = await res.text();
    await py.runPythonAsync(src);
    return py;
  })();

  try {
    return await window.__nyxPyodide;
  } catch (e) {
    // Allow retry on next mount
    window.__nyxPyodide = undefined;
    throw e;
  }
}

// ===== Hook =====
export interface UseNyxKernel {
  ready: boolean;
  loading: boolean;
  error: string | null;
  runSimulation: (
    scenario: Scenario,
    rounds?: number,
    seed?: number,
  ) => Promise<SimulationResult>;
}

export function useNyxKernel(): UseNyxKernel {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPyodide()
      .then(() => {
        if (cancelled) return;
        setReady(true);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runSimulation(
    scenario: Scenario,
    rounds = 3,
    seed = 42,
  ): Promise<SimulationResult> {
    const py = await getPyodide();
    const payload = JSON.stringify({ scenario, rounds, seed });
    py.globals.set("__nyx_payload", payload);
    const jsonOut = py.runPython(`
import json as __json
__p = __json.loads(__nyx_payload)
__r = run_simulation(__p["scenario"], __p["rounds"], __p["seed"])
__json.dumps(__r)
`) as string;
    const parsed = JSON.parse(jsonOut) as {
      state_history: RoundState[];
      outcome_vector: OutcomeVector;
      seed: number;
    };
    return {
      stateHistory: parsed.state_history,
      outcomeVector: {
        ...parsed.outcome_vector,
        simulation_time: parsed.state_history.length,
      },
      seed: parsed.seed,
    };
  }

  return { ready, loading, error, runSimulation };
}
