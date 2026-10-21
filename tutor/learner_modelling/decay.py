"""Ebbinghaus Forgetting Curve and memory decay engine for PRAG-TUTOR.

Models retention decay over time towards baseline prior and adapts stability
based on spaced retrieval outcomes.
"""

import math
from typing import Any, Dict, Tuple

DEFAULT_STABILITY_DAYS = 7.0
REFRESHER_THRESHOLD = 0.70
BASELINE_PRIOR = 0.20


def compute_effective_mastery(
    p_known: float,
    elapsed_days: float,
    memory_stability: float = DEFAULT_STABILITY_DAYS,
    p_prior: float = BASELINE_PRIOR,
) -> Dict[str, Any]:
    """Computes time-decayed mastery score using exponential retention decay.

    Formula:
        R(t) = exp(-t / S)
        P_effective(t) = P_prior + (P_known - P_prior) * R(t)

    Args:
        p_known: Last computed mastery probability P(L_t)
        elapsed_days: Number of days since last assessment
        memory_stability: Memory stability S in days
        p_prior: Asymptotic baseline prior P(L_0)

    Returns:
        Dict with effective_mastery, needs_refresher, and mastered.
    """
    days = max(0.0, float(elapsed_days))
    stability = max(0.5, float(memory_stability))
    p_k = min(max(float(p_known), 0.0), 1.0)
    p_0 = min(max(float(p_prior), 0.0), 1.0)

    decay_factor = math.exp(-days / stability)
    effective = p_0 + (p_k - p_0) * decay_factor
    effective = min(max(effective, 0.0), 1.0)

    needs_refresher = (p_k >= 0.85 and effective < REFRESHER_THRESHOLD)
    is_effectively_mastered = (effective >= 0.85) or (p_k >= 0.85 and not needs_refresher)

    return {
        "effective_mastery": round(effective, 4),
        "needs_refresher": needs_refresher,
        "mastered": is_effectively_mastered,
    }


def update_stability(
    current_stability: float,
    review_streak: int,
    accuracy: float,
) -> Tuple[float, int]:
    """Updates memory stability S and review streak based on quiz accuracy.

    Args:
        current_stability: Current stability S in days
        review_streak: Consecutive successful review sessions
        accuracy: Fraction of questions answered correctly (0.0 to 1.0)

    Returns:
        Tuple of (new_stability, new_streak)
    """
    curr_s = max(0.5, float(current_stability))
    streak = max(0, int(review_streak))
    acc = min(max(float(accuracy), 0.0), 1.0)

    if acc >= 0.67:
        new_streak = streak + 1
        new_stability = min(90.0, round(curr_s * (1.0 + 0.5 * new_streak), 2))
    elif acc < 0.50:
        new_streak = 0
        new_stability = max(3.0, round(curr_s * 0.75, 2))
    else:
        new_streak = streak
        new_stability = curr_s

    return (new_stability, new_streak)
