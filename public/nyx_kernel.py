# nyx_kernel.py — Deterministic Cognitive Engine for Nyx v6.5
# Zero external dependencies. Runs in CPython 3.10+, Pyodide, and Streamlit.
# Licensed under MIT. Built by Harsh Dubey.

import random
import json
from typing import Any


# ---------------------------------------------------------------------------
# Seeded PRNG (mulberry32) — seed=42 always produces identical output
# ---------------------------------------------------------------------------
def mulberry32(seed: int):
    state = seed | 0
    def rand():
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = ((state ^ (state >> 15)) * (state | 1)) & 0xFFFFFFFF
        t ^= (t + ((t ^ (t >> 7)) * (state | 61))) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) >> 0) / 4294967296
    return rand


def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def sigmoid(x: float) -> float:
    if x < -20: return 0.0
    if x >  20: return 1.0
    return 1.0 / (1.0 + 2.718281828459045 ** (-x))


# ---------------------------------------------------------------------------
# CognitiveAgent — 10 bounded state variables + bridge
# ---------------------------------------------------------------------------
class CognitiveAgent:
    def __init__(self, name: str, role: str, personality: str):
        self.name = name
        self.role = role
        self.personality = personality
        self.self_worth = 0.5
        self.anxiety = 0.3
        self.consistency = 0.5
        self.momentum = 0.5
        self.reputation = 0.5
        self.opportunity_access = 0.5
        self.fragility_index = 0.3
        self.lock_in = 0.2
        self.learning_rate = 0.5
        self.energy = 0.8
        self.phenomenological_penetration = 0.6
        self.mode = "EXECUTE"
        self.contradiction_score = 0.0
        self.emotional_anchor = None
        self.cascade_active = False
        self.failure_streak = 0
        self.success_streak = 0
        self.blocked = False
        self.blocked_rounds = 0
        self.temp_modifiers = {"consistency_boost": 0.0, "fragility_boost": 0.0}

    def perception_filter(self, raw_event: float, existence_value: float) -> float:
        return raw_event * self.phenomenological_penetration * existence_value

    def cognitive_update(self, perceived_events: list[float], rng, peer_gap: float,
                         event_driven: float, success_flag: bool, failure_flag: bool,
                         mentor_flag: bool, social_feedback: float,
                         signal_boost: float):
        # Critical-fix sprint: linear emotional inertia, reduced peer conformity,
        # persistence term on self_worth, lighter anxiety smoothing, undamped
        # momentum, contrarian doubt and seeded jitter.
        ctx = max(0.0, min(1.0, 0.5 + 0.5 * (self.self_worth - self.anxiety)))
        progress = self.consistency * (0.6 + 0.4 * self.momentum)
        self.reputation = clamp(self.reputation + 0.2 * progress + 0.1 * signal_boost)
        self.opportunity_access = clamp(
            self.opportunity_access + 0.25 * (1 if self.consistency * self.reputation > 0.4 else 0) + 0.15 * mentor_flag)
        prev_sw = self.self_worth
        prev_delta = getattr(self, "_last_sw_delta", 0.0)
        self.self_worth = clamp(
            self.self_worth + 0.35 * progress - 0.15 * max(peer_gap, 0)
            + 0.2 * social_feedback - 0.25 * failure_flag + 0.1 * prev_delta)
        raw_anxiety_change = ctx * (0.4 * max(peer_gap, 0) + 0.3 * event_driven) - 0.2 * success_flag
        self.anxiety = clamp(0.4 * self.anxiety + 0.6 * clamp(self.anxiety + raw_anxiety_change))
        self.momentum = clamp(self.momentum + 0.25 * self.success_streak - 0.3 * self.failure_streak)
        self.fragility_index = clamp(self.fragility_index + self.temp_modifiers["fragility_boost"])
        self.lock_in = clamp(self.lock_in + 0.1 * self.consistency)
        self.learning_rate = clamp(self.learning_rate + 0.1 * failure_flag - 0.05 * success_flag)
        self.energy = clamp(self.energy - 0.05 + 0.1 * success_flag)
        self.phenomenological_penetration = clamp(
            self.phenomenological_penetration + 0.1 * self.anxiety - 0.05 * self.consistency)
        # Contrarian doubt + seeded jitter to break uniform locking / convergence.
        if self.lock_in > 0.8 and rng() < 0.1:
            self.consistency = clamp(self.consistency - 0.1)
        self.self_worth = clamp(self.self_worth + (rng() - 0.5) * 0.04)
        self._last_sw_delta = self.self_worth - prev_sw
        if success_flag:
            self.success_streak += 1; self.failure_streak = 0
        elif failure_flag:
            self.failure_streak += 1; self.success_streak = 0
        if self.failure_streak >= 3 and self.self_worth < 0.4:
            self.cascade_active = True
        if success_flag or mentor_flag:
            self.cascade_active = False; self.failure_streak = 0
            self.momentum += 0.3; self.self_worth += 0.15
        # Safety gate
        if self.anxiety > 0.9 and self.self_worth < 0.1 and self.cascade_active:
            self.blocked = True; self.blocked_rounds += 1; self.mode = "AVOID"
        elif self.blocked:
            self.self_worth = clamp(self.self_worth + 0.1)
            self.anxiety = clamp(self.anxiety - 0.1)
            self.blocked_rounds += 1
            if self.blocked_rounds >= 3:
                self.self_worth = 0.4; self.anxiety = 0.5; self.momentum = 0.5
                self.cascade_active = False; self.blocked = False; self.blocked_rounds = 0
        else:
            self.blocked = False; self.blocked_rounds = 0

    def emit_intent(self, rng, existence_values: dict[str, float]) -> dict:
        if self.blocked:
            return {"type": "AVOID", "strength": 0.0, "target": None}
        p_exec = sigmoid(self.self_worth + self.momentum - self.anxiety)
        p_avoid = sigmoid(self.anxiety - self.self_worth)
        p_recov = sigmoid(1 - self.anxiety + self.failure_streak * 0.1)
        p_optim = sigmoid(self.momentum + self.consistency - 0.5)
        total = p_exec + p_avoid + p_recov + p_optim
        probs = [p_exec/total, p_avoid/total, p_recov/total, p_optim/total]
        modes = ["EXECUTE", "AVOID", "RECOVER", "OPTIMIZE"]
        if self.anxiety > 0.7:
            if self.self_worth > 0.6: probs[0] *= 1.5
            else: probs[1] *= 1.5
            total = sum(probs); probs = [p/total for p in probs]
        r = rng(); cumulative = 0; chosen = modes[-1]
        for i, p in enumerate(probs):
            cumulative += p
            if r <= cumulative: chosen = modes[i]; break
        self.mode = chosen
        strength = clamp(self.self_worth + self.momentum - self.anxiety)
        if existence_values:
            sorted_agents = sorted(existence_values.items(), key=lambda x: -x[1])
            if rng() < 0.8:
                target = sorted_agents[min(len(sorted_agents)-1, int(rng()*5))][0] if sorted_agents else None
            else:
                others = [a for a in existence_values if a not in [x[0] for x in sorted_agents[:5]]]
                target = others[int(rng()*len(others))] if others else None
        else:
            target = None
        return {"type": chosen, "strength": strength, "target": target}

    def snapshot(self) -> dict:
        return {
            "name": self.name, "role": self.role, "mode": self.mode,
            "self_worth": round(self.self_worth, 3), "anxiety": round(self.anxiety, 3),
            "consistency": round(self.consistency, 3), "momentum": round(self.momentum, 3),
            "reputation": round(self.reputation, 3), "opportunity_access": round(self.opportunity_access, 3),
            "fragility_index": round(self.fragility_index, 3), "lock_in": round(self.lock_in, 3),
            "learning_rate": round(self.learning_rate, 3), "energy": round(self.energy, 3),
            "contradiction_score": round(self.contradiction_score, 3),
            "cascade_active": self.cascade_active, "blocked": self.blocked
        }


def run_simulation(scenario: dict, rounds: int = 3, seed: int = 42) -> dict:
    rng = mulberry32(seed)
    agents = {}
    for a in scenario.get("agents", []):
        agent = CognitiveAgent(a["name"], a.get("role", ""), a.get("personality", ""))
        if "initial_state" in a:
            for k, v in a["initial_state"].items():
                if hasattr(agent, k): setattr(agent, k, v)
        if "emotional_anchor" in a:
            agent.emotional_anchor = a["emotional_anchor"]
        # Critical-fix sprint #1: seeded ±0.08 noise so different seeds produce
        # genuinely different trajectories and outcome vectors.
        agent.self_worth = clamp(agent.self_worth + (rng() - 0.5) * 0.16)
        agent.anxiety = clamp(agent.anxiety + (rng() - 0.5) * 0.16)
        agent.consistency = clamp(agent.consistency + (rng() - 0.5) * 0.16)
        agents[a["name"]] = agent

    state_history = []
    W = scenario.get("influence_network", {})
    intents_for_next_round = {}

    for r in range(rounds):
        round_state = {}
        world_snapshot = {
            "reputation_mean": sum(a.reputation for a in agents.values()) / max(len(agents), 1),
            "inequality": sum((a.opportunity_access - 0.5)**2 for a in agents.values()) / max(len(agents), 1),
            "trust_proxy": sum(a.lock_in for a in agents.values()) / max(len(agents), 1),
            "centralization": sum(abs(W.get(src, {}).get(tgt, 0)) for src in agents for tgt in agents) / max(len(agents)**2, 1)
        }
        for name, agent in agents.items():
            peer_gap = world_snapshot["reputation_mean"] - agent.reputation
            event_driven = rng() * 0.2
            success_flag = rng() < clamp(0.2 + 0.5*agent.consistency + 0.2*agent.opportunity_access)
            failure_flag = rng() < clamp(0.2 + 0.4*agent.anxiety + 0.2*agent.fragility_index)
            mentor_flag = (agent.consistency > 0.6) and (rng() < clamp(0.3 + 0.3*agent.reputation))
            social_feedback = rng() * 0.3 - 0.15
            signal_boost = 1.0 if success_flag else 0.0
            agent.cognitive_update([], rng, peer_gap, event_driven, success_flag, failure_flag,
                                  mentor_flag, social_feedback, signal_boost)
            existence_values = {
                n: 0.4*a.opportunity_access + 0.35*(1-abs(agent.opportunity_access-a.opportunity_access))
                   + 0.25*agent.phenomenological_penetration
                for n, a in agents.items() if n != name
            }
            intents_for_next_round[name] = agent.emit_intent(rng, existence_values)
            round_state[name] = agent.snapshot()
        state_history.append({"round": r+1, "agents": round_state, "world": world_snapshot})
        for a in agents.values():
            a.temp_modifiers = {"consistency_boost": 0.0, "fragility_boost": 0.0}

    outcome = {
        "reputation_mean": sum(a.reputation for a in agents.values()) / max(len(agents), 1),
        "inequality": sum((a.opportunity_access - 0.5)**2 for a in agents.values()) / max(len(agents), 1),
        "trust_proxy": sum(a.lock_in for a in agents.values()) / max(len(agents), 1),
        "centralization": sum(abs(W.get(src, {}).get(tgt, 0)) for src in agents for tgt in agents) / max(len(agents)**2, 1)
    }
    return {"state_history": state_history, "outcome_vector": outcome, "seed": seed}
