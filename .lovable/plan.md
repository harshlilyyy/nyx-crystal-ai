## Goal
Add four dynamical-systems primitives (attractor formalization, heterogeneous cascade thresholds, narrative entropy, scale-free network init) to Nyx Advanced Simulation. All gated by Advanced Simulation toggle. No new persistent state — values are derived per-round or treated as init-time parameters held in transient module-level maps keyed by simulation seed.

## Files

### New: `src/lib/nyx-dynamics.ts`
Pure deterministic helpers (no React, no persistence):

1. **Attractor centroids** — hard-coded reference centroid table per verdict mode (STABLE_CONVERGENCE / POLARIZED_STALEMATE / FRAGMENTED_FAILURE / CENTRALIZED_CONTROL / ADAPTIVE_COMPROMISE / CASCADING_BREAKDOWN) for the 4-dim outcome vector + a 5-dim agent attractor centroid (self_worth, anxiety, momentum, consistency, reputation). Centroids derived from telemetry heuristics in `nyx-trajectory.ts`.
2. `computeAttractorProximity(coreState, mode)` → cosine similarity in [0,1].
3. `computeNarrativeEntropy(modes: string[])` → Shannon entropy over {AVOID, RECOVER, EXECUTE, OPTIMIZE} bucketed from `modeV5`/`mode`.
4. `cascadeThresholdForAgent(seed, agentId)` — bounded normal (μ=0.40, σ=0.08, clamp [0.25, 0.55]) via deterministic mulberry32 keyed by `(seed XOR hash(agentId))`. Pure function, no caching needed.
5. `buildScaleFreeNetwork(agentIds, seed, reputations)` — Barabási–Albert: 3 fully-connected seed nodes, then each new agent adds 2 outgoing edges sampled by reputation∝probability via mulberry32. Returns `Record<string, Record<string, number>>` weight map.

### Edit: `src/lib/nyx-causal.ts`
- In `applyV5Round` (cascade trigger location): add advanced-only branch that uses `failureStreak >= 3 && self_worth < cascadeThresholdForAgent(seed, agentId)` instead of fixed `< 0.4`. Gate by passing a new optional `cascadeThresholds?: Record<string, number>` parameter (default undefined → existing behavior). Round numeric updates to 3 decimals where the spec demands.
- Export a small `attractorCentroidForMode` lookup re-exported from `nyx-dynamics.ts`.

### Edit: `src/routes/simulation.tsx`
- Maintain transient session-only refs (NOT persisted to nyx-store):
  - `attractorProximityRef`: `Record<agentId, number[]>` (last 10 rounds).
  - `lockedRoundsRef`: `Record<agentId, number>` (consecutive rounds with proximity > 0.90).
  - `entropyHistoryRef`: `number[]` (per round).
  - `cascadeThresholdsRef`: `Record<agentId, number>` (computed once on first advanced round).
  - `influenceNetworkRef`: `Record<string, Record<string, number>>` (Barabási–Albert init on first advanced round, used by Hebbian/decay logic that already exists).
- After each `applyV5Round`, compute proximity per agent + entropy; push to refs.
- Pass `cascadeThresholds` into `applyV5Round`.
- Pass refs down to telemetry + agent drill-down sub-components.

### New: `src/components/AttractorTelemetryCards.tsx`
Mounted in Telemetry Hub area of `simulation.tsx` only when `sim.advanced`. Renders:
- Narrative Diversity sparkline (Recharts LineChart) with red threshold line at y=0.8.
- Strongest attractor basin readout (mode with highest mean proximity).
- Cascade activation histogram (Recharts BarChart) — buckets of cascade thresholds.
- Top network hubs (top-3 by weighted out-degree).

### Edit: `src/routes/agents.tsx` (Agent Drill-Down area)
Add per-agent panel (advanced only):
- Attractor proximity sparkline (last 10 rounds).
- Cascade threshold radial gauge (single SVG arc + numeric label).
- 🔒 Locked badge when `lockedRoundsRef[agentId] >= 3`.
- Local network degree readout.

If agents.tsx doesn't have a drill-down, add inline cards below the agent list.

## Determinism & Constraints
- All RNG via `mulberry32(seed)` from `nyx-causal.ts`. No `Math.random()` in new code.
- All vectors `Math.round(x * 1000) / 1000` after compute.
- Fixed iteration order: `Object.keys(runtime).sort()` where ordering matters.
- Refs are React `useRef` — recomputed per simulation run, never stored in nyx-store / Supabase / localStorage.

## Out of scope
- Standard debate mode (advanced OFF unaffected).
- Modifying perception filter, cascade/recovery equations beyond the threshold swap, regret matching, narrative binding, episodic replay, bridge, one-tick lag.
- Persisting any new field on `Simulation` / `AgentRuntime` types.
- Real historical calibration of attractor centroids (heuristic only this phase).

## Verification
- Advanced OFF: no new UI, no behavior change.
- Cascade now fires only on `failureStreak ≥ 3 AND self_worth < threshold_i`.
- Same seed twice → identical proximity sparklines, identical entropy series, identical network topology.
- Entropy sparkline visible in Telemetry Hub; threshold line at 0.8.
- Build passes.
