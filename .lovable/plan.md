## Goal
Add architectural validation, calibration, scale-ceiling docs, and one performance refactor to Nyx Advanced Simulation. Pure additive work — gated behind the existing Advanced Simulation toggle, no new persistent state, no equation changes.

## Scope of changes

### 1. Polarization Benchmark (Part 1, item 2)
- Add a new component `src/components/PolarizationBenchmark.tsx`.
- Mount it inside the existing Telemetry Hub area (in `src/routes/simulation.tsx`) as a collapsible expander, only visible when Advanced Simulation is ON.
- Provides a "Run Benchmark" button that runs three controlled scenarios (balanced / skewed / polarized initial `self_worth` distributions) across 10 seeds each, reusing `applyV5Round` from `src/lib/nyx-causal.ts` on jittered runtime clones (same pattern as `runProbabilityCloud` in `nyx-v8.ts`).
- For each scenario × round, computes:
  - `polarization_score = stddev(self_worth)`
  - `convergence_score = 1 - polarization_score`
- Renders three small line charts (reuse Recharts already in the project) plus a short note describing the expected qualitative pattern from the Prophet (Scientific Reports 2025) paper.
- Results live in component state only — no persistence, no global store mutation.

### 2. AgentSet single-pass refactor (Part 2, item 4)
- In `src/lib/nyx-causal.ts`, locate the per-round update inside `applyV5Round` (and any sibling functions that loop separately for cognitive update, cascade check, safety gate, intent emission).
- Consolidate into a single `for (const id of agentIds)` pass per round, calling the existing per-agent helpers in sequence. Equations untouched.
- Add a brief code comment referencing Mesa AgentSet `do("step")` rationale.

### 3. Universal `simulation_time` (Part 2, item 5)
- In `src/routes/simulation.tsx` (or wherever the outcome vector is finalized), add a deterministic `simulation_time` field equal to `rounds.length` (or current round index) on the outcome vector object.
- Type addition is non-persistent: extend the in-memory outcome shape only; no Supabase / store schema change.

### 4. LARA mapping tooltips (Part 1, item 3)
- In the Neural Kernel Vault UI (existing element in `src/routes/simulation.tsx` — the kernel/architecture display under Advanced Simulation), wrap the five existing layer labels (Perception, Memory, Preprocessor / Mode transitions, Decision-making / Intent, Postprocessor / Outcome) with shadcn `Tooltip` containing the LARA→Nyx mapping text from the spec.
- If discrete labels don't exist yet, add a small "Cognitive Architecture (LARA mapping)" subsection listing the five mappings.

### 5. Three informational cards in the Neural Kernel Vault
- **Scale Ceiling** (Part 3, item 6): "Current agent ceiling: 50 (browser-based TypeScript loop). Architecture supports 1,000+ agents when connected to OASIS or AgentSociety backend (v8 toggle)."
- **Multi-Level Simulation** placeholder (Part 3, item 7): in the v8 Experimental panel section.
- **Performance Horizon** (Part 4, item 8): BioDynaMo 1.72B agents reference.
- All three are static `<Card>` elements with the iOS glass styling already used elsewhere; only render when Advanced Simulation toggle is ON.

### 6. v8 OASIS toggle wiring note (Part 3, item 6, second half)
- The existing `checkOasisReachable` helper in `src/lib/nyx-v8.ts` already exists. Add a one-line status pill in the Scale Ceiling card showing whether the v8 OASIS endpoint is reachable when the toggle is on. No engine swap is implemented — only the documented architectural pathway, since OASIS itself is external.

## Out of scope (explicitly not changing)
- Standard debate mode (Advanced Simulation OFF path).
- Outcomes tab and its 9 panels.
- Bidirectional bridge, perception filter, cascade/recovery, episodic replay, regret matching, deterministic narrative binding equations.
- Persistent state in the nyx-store / Supabase.
- iOS glass design tokens.

## Files touched
- `src/components/PolarizationBenchmark.tsx` (new)
- `src/components/KernelVaultArchitectureCards.tsx` (new — holds the 3 informational cards + LARA mapping tooltips)
- `src/lib/nyx-causal.ts` (single-pass refactor, no equation change)
- `src/routes/simulation.tsx` (mount benchmark + cards, add `simulation_time` to outcome vector)

## Verification
- Confirm Advanced Simulation OFF still renders only the existing standard debate UI (no new cards, no benchmark button).
- Confirm Advanced Simulation ON shows: Polarization Benchmark expander + 3 architecture cards + LARA tooltips.
- Confirm benchmark "Run Benchmark" runs without blocking the UI (yields with `await new Promise(r => setTimeout(r, 0))` between runs, same pattern as `runProbabilityCloud`).
- Build passes.
