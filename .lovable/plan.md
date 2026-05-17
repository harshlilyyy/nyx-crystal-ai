# Complex Systems Expansion Pack

All features gated on `sim.advanced`. No persistent state added. Session-only refs/memos. Standard debate mode untouched.

## New files

**`src/lib/nyx-complex.ts`** — pure helpers (no React):
- `computePredictionError(prev, observed, momentum)` → number
- `applyActiveInferenceEffects(rt, predErr, history)` → mutates anxiety, learning_rate, lock_in
- `rollingVariance(series, window=5)` → number
- `detectEarlyWarnings(varHist, recoveryHist)` → `{ instability: boolean, slowing: boolean, stability: 0..100 }`
- `updateReplicatorDynamics(probs, successByMode)` → new probs (clamped [0.05,0.7])
- `computeModeSuccess(roundDelta, cascadeFlag)` → number
- `applyCascadeContagion(runtime, W)` → mutates anxiety/trust_proxy on direct neighbors only
- `applyHomeostasis(runtime, telemetry)` → stabilizing nudges
- `decayMemory(buffer, eventKind?)` → strength updates
- All deterministic, O(n) or O(n²) over agents.

**`src/components/SystemStabilityCard.tsx`** — stability meter (0–100), variance sparkline (Recharts), warning badges. Frosted glass, rose-gold accents on warnings.

**`src/components/DominantStrategiesCard.tsx`** — line chart of mode prevalence (AVOID red, RECOVER green, EXECUTE blue, OPTIMIZE purple) from history. For Outcomes tab.

**`src/components/ScenarioOutlookCard.tsx`** — Forecast Mode toggle + button. Runs 5 trials via `setTimeout` chunking (skip kernel/LLM, just `applyV5Round` loop). Shows bar chart with 90% CI for trust/inequality/polarization/centralization.

**`src/components/ResearchConceptsCard.tsx`** — concept list with tooltips (Active Inference/Friston, Cascade/Granovetter, etc.). Inter font, frosted glass.

**`src/components/CascadePressureGlow.tsx`** (or inline) — small glow indicator for agent chips.

## Edits

**`src/routes/simulation.tsx`**:
- Add transient refs: `predictionErrorHistoryRef`, `varianceHistoryRef`, `recoveryTimeRef`, `modePrevalenceHistoryRef`, `modeProbsRef`, `memoryStrengthHistoryRef`, `cascadePressureRef`.
- Inside `runRound` after `applyV5Round`:
  1. Compute trust_proxy (mean rep across agents) + prediction_error per agent → apply effects.
  2. Track variance/recovery → detect warnings.
  3. Compute mode success → update replicator probs → store prevalence snapshot.
  4. Apply cascade contagion using `influenceNetworkRef`.
  5. Apply homeostasis when thresholds tripped.
  6. Decay memory strength.
- Render new cards (advanced + v5 only): `SystemStabilityCard`, `ResearchConceptsCard`. Mount `ScenarioOutlookCard` in Outcomes tab.
- Add Forecast Mode toggle inside Controls (advanced only).

**`src/routes/outcomes.tsx`** — mount `DominantStrategiesCard` and `ScenarioOutlookCard` (advanced only).

**`src/components/AttractorTelemetryCards.tsx`** — add Prediction Error sparkline + Memory Intensity sparkline in Agent Drill-Down (reuses per-agent series from refs passed via new optional props).

## Performance guards

- Skip everything when `!sim.advanced || !hasV5`.
- Cap history arrays at 50 entries.
- Forecast trials use synchronous deterministic loop wrapped in `setTimeout(_, 0)` chunks, max 5 trials, no LLM calls.
- If a try/catch around a feature throws, toast warning and disable for the session.

## Out of scope

- No backend / Supabase changes.
- No new types in `nyx-types.ts` (memory_strength stored in transient ref, not persisted).
- No changes to standard debate path or kernel.
- Cascade contagion is single-hop, non-recursive.
