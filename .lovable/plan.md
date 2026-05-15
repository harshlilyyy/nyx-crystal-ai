## Goal
Add a validation, probabilistic aggregation, and evidence-grounding pipeline to Nyx Advanced Simulation. All additions are gated behind the existing Advanced Simulation toggle, no new persistent state, no equation changes.

## Scope

### Part 1 — Reproducibility & Validation (Telemetry Hub)
New component `src/components/ValidationSuite.tsx` mounted in Telemetry Hub area of `src/routes/simulation.tsx` (only rendered when Advanced Simulation is ON). Three buttons inside one collapsible expander:

1. **Reproducibility Check** — runs `applyV5Round` 3× with the same seed using `setSimulationSeed`, snapshots all 10 core variables per agent per round, asserts equality to 3 decimals, reports max deviation + ✅/❌ pill.
2. **Polarization Benchmark** — extend the existing `PolarizationBenchmark.tsx` (already implemented) to also compute final-round `convergence_score` next to the trajectory chart. (No duplicate component.)
3. **Ablation Test** — runs 10 simulations, each with one of the 10 core variables clamped to 0.5 (overwrite in `rt.core` before each `applyV5Round` call). Computes ΔS_damped vs. baseline using existing `successScore`/`v5Telemetry`. Renders horizontal Recharts bar chart ranking variables.

### Part 2 — Probabilistic Aggregation (Deterministic Kernel section)
New component `src/components/MultiTrialAggregation.tsx`, only mounted when `kernelEnabled` (deterministic kernel) is ON.

4. **Multi-Trial Mode checkbox** — when checked, "Run Kernel" runs 30 trials with seeds 1..30 via `kernel.runSimulation`. Aggregates `outcomeVector` components (mean, stddev, 90% CI via percentile).
5. **Trajectory clustering** — K-means K=3 on the 30 outcome vectors (4-dim Euclidean). Label clusters by heuristic rules ("Stable Convergence" / "Polarized Stalemate" / "Fragmented Failure") based on `trust_proxy`/`inequality` thresholds. Pie chart (Recharts) + top-3 distinguishing variables per cluster (highest |centroid - global mean|).
6. **Calibrated probability display** — apply Platt scaling (logistic σ(a·x + b)) on the cluster membership counts to derive Policy Success / Backlash / Implementation Collapse %. Static `a=4, b=-2` defaults documented as session-only. Show "⚠ Not historically calibrated" badge.

### Part 3 — Evidence Grounding
7. **EvidenceValidator** — new helper `src/lib/nyx-evidence.ts` with `validateClaim(claim: string, prevCore, currCore): { grounded: boolean; reason?: string; variable?: string }`. Uses keyword matching ("trust rising/falling", "anxiety up/down", "polarization") against the actual delta sign in `core`. Called inside the existing per-agent debate generation loop in `src/routes/simulation.tsx` (only when V5 runtime exists). When ungrounded: render a "⚠ Ungrounded" badge on the debate card + append a grounding instruction to the next prompt for that agent. Never overrides output.
8. **Historical Anchor card** — added to `src/routes/setup.tsx` Simulation Setup form. File input (CSV), dropdown for target metric (4 options). On submit, store `{filename, metric, csvPreview}` in `localStorage` under key `nyx_historical_anchor` (transient — not in nyx-store). Show "⚠ Historical calibration requires 1,000-seed parameter sweeps — coming in Phase 2."

## Files touched
- `src/components/ValidationSuite.tsx` (new)
- `src/components/MultiTrialAggregation.tsx` (new)
- `src/components/EvidenceBadge.tsx` (new — small badge component)
- `src/lib/nyx-evidence.ts` (new — validator helper)
- `src/components/PolarizationBenchmark.tsx` (small addition: convergence_score readout)
- `src/routes/simulation.tsx` (mount ValidationSuite, MultiTrialAggregation, wire EvidenceValidator into debate loop)
- `src/routes/setup.tsx` (Historical Anchor card)

## Out of scope
- Standard debate path (Advanced Simulation OFF)
- Outcomes tab
- Bidirectional bridge / cascade / episodic replay equations
- Persistent state in nyx-store / Supabase
- Real historical calibration (Phase 2)

## Verification
- Advanced Simulation OFF: no new UI appears.
- Reproducibility Check returns ✅ with deviation 0.000 (deterministic engine).
- Ablation chart shows non-zero bars.
- Multi-Trial Mode produces 30 outcome vectors and pie chart sums to 100%.
- Ungrounded claim flag appears when trust_proxy delta sign contradicts agent text.
- Build passes.
