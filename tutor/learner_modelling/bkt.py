"""Bayesian Knowledge Tracing (BKT) engine for PRAG-TUTOR.

Implements standard Corbett & Anderson BKT model for 4-option MCQs.
"""

from typing import Any, Dict, List

DEFAULT_P_INIT = 0.20
DEFAULT_P_LEARN = 0.15
DEFAULT_P_GUESS = 0.25
DEFAULT_P_SLIP = 0.10
MASTERY_THRESHOLD = 0.85


def update_bkt_step(
    p_known: float,
    is_correct: bool,
    p_learn: float = DEFAULT_P_LEARN,
    p_guess: float = DEFAULT_P_GUESS,
    p_slip: float = DEFAULT_P_SLIP,
) -> float:
    """Updates mastery probability after a single response using Bayes rule + transition.

    Args:
        p_known: Prior mastery probability P(L_t)
        is_correct: Whether the learner answered correctly
        p_learn: Transition/learning probability P(T)
        p_guess: Guess probability P(G)
        p_slip: Slip probability P(S)

    Returns:
        Updated posterior probability P(L_{t+1}) rounded to 4 decimals.
    """
    p_clamped = min(max(float(p_known), 0.001), 0.999)

    if is_correct:
        numerator = p_clamped * (1.0 - p_slip)
        denominator = numerator + ((1.0 - p_clamped) * p_guess)
    else:
        numerator = p_clamped * p_slip
        denominator = numerator + ((1.0 - p_clamped) * (1.0 - p_guess))

    p_obs = numerator / denominator if denominator > 0 else p_clamped
    p_next = p_obs + (1.0 - p_obs) * p_learn

    return round(min(max(p_next, 0.001), 0.999), 4)


def update_bkt_sequence(
    p_known: float,
    observations: List[bool],
    p_learn: float = DEFAULT_P_LEARN,
    p_guess: float = DEFAULT_P_GUESS,
    p_slip: float = DEFAULT_P_SLIP,
) -> Dict[str, Any]:
    """Updates mastery probability across a sequence of binary response observations.

    Args:
        p_known: Starting prior mastery probability P(L_0)
        observations: List of boolean outcomes (True=correct, False=incorrect)
        p_learn: Transition/learning probability P(T)
        p_guess: Guess probability P(G)
        p_slip: Slip probability P(S)

    Returns:
        Dict with prior_mastery, posterior_mastery, and mastered boolean.
    """
    prior = round(min(max(float(p_known), 0.001), 0.999), 4)
    current_p = prior

    for obs in observations:
        current_p = update_bkt_step(
            current_p,
            bool(obs),
            p_learn=p_learn,
            p_guess=p_guess,
            p_slip=p_slip,
        )

    return {
        "prior_mastery": prior,
        "posterior_mastery": current_p,
        "mastered": current_p >= MASTERY_THRESHOLD,
    }
