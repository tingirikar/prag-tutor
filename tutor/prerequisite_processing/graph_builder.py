"""Generates prerequisite relationships among candidate learning topics via LLM inference with pedagogical necessity prompting and criticality weights."""

import json
import logging
from typing import Any, Callable, Dict, List, Optional, Union

from tutor.prerequisite_processing.topic_extraction import (
    canonicalize_lexical_name,
    parse_json_safely,
)

logger = logging.getLogger(__name__)


def generate_prerequisite_graph(
    topics: Union[List[str], List[Dict[str, Any]]],
    doc_summary: str = "",
    call_llm_fn: Callable[[str, str], str] = None,
    return_details: bool = False,
) -> Union[Dict[str, List[str]], Dict[str, List[Dict[str, Any]]]]:
    """Prompts the LLM to infer educational prerequisites for each topic enforcing strict pedagogical necessity.

    Enforces:
    - Order & Context passed into the prompt.
    - Strict Pedagogical Necessity: A is a prerequisite of B only if B cannot be understood without A.
    - No sibling/contrasting topics as prerequisites (e.g., BFS vs DFS, TCP vs UDP).
    - Foundational earlier concepts are preferred prerequisites for later concepts.
    - 0 to 4 true prerequisites strictly from candidate list.
    - Criticality weights between 0.50 and 1.00 and concise reasons.
    - Filters weak edges (<0.50) and self-dependencies.
    - Supports returning simple Dict[str, List[str]] (sorted by weight descending) or detailed Dict[str, List[Dict]].
    """
    if not topics:
        return {}

    # 1. Normalize candidate topics input and construct lookup maps
    candidates_list: List[Dict[str, Any]] = []
    canonical_lookup: Dict[str, str] = {}
    lexical_lookup: Dict[str, str] = {}

    for idx, item in enumerate(topics):
        if isinstance(item, dict):
            t_name = str(item.get("topic", "")).strip()
            order = int(item.get("first_seen_order", idx))
            context = str(item.get("context_hint", "")).strip()
        else:
            t_name = str(item).strip()
            order = idx
            context = ""

        if not t_name:
            continue

        cand_record = {
            "topic": t_name,
            "first_seen_order": order,
            "context_hint": context,
        }
        candidates_list.append(cand_record)
        canonical_lookup[t_name.lower()] = t_name
        lexical_lookup[canonicalize_lexical_name(t_name)] = t_name

    if not candidates_list:
        return {}

    prompt_candidates = [
        {
            "topic": c["topic"],
            "appearance_order": c["first_seen_order"],
            "context_hint": c["context_hint"] or "Educational concept in document",
        }
        for c in candidates_list
    ]

    candidates_json = json.dumps(prompt_candidates, indent=2)

    prompt = f"""You are an expert pedagogical curriculum designer analyzing topic prerequisites.

Analyze the candidate learning topics below extracted from: {doc_summary or "Educational Document"}

Candidate Topics Set (ordered by appearance in text):
{candidates_json}

CRITICAL RULES FOR PREREQUISITE GENERATION:
1. STRICT PEDAGOGICAL NECESSITY TEST:
   - Topic A is a prerequisite of Topic B ONLY IF a student CANNOT understand the core mechanism or definition of B without first knowing A.
   - DO NOT mark A as a prerequisite of B just because they are sibling subtopics, contrasting approaches (e.g., BFS vs. DFS, TCP vs. UDP), or mentioned in the same paragraph.
   - Foundational concepts introduced earlier in the document (lower appearance order) are much more likely to be prerequisites for advanced concepts introduced later, not vice versa.
2. PREREQUISITES MUST COME STRICTLY FROM THE CANDIDATE LIST:
   - Only select prerequisites from the candidate topics list above.
   - Do NOT invent external prerequisites or rephrase candidate topic names.
3. PREREQUISITE COUNT (0 to 4 max):
   - Foundational entry-level topics in the course MUST have [] (0 prerequisites).
   - Use 1 to 2 prerequisites when genuinely required.
   - Never exceed 4 prerequisites per topic.
4. NO SELF-DEPENDENCIES OR TRIVIAL CYCLES:
   - A topic CANNOT be its own prerequisite.
5. CRITICALITY WEIGHTS & REASON:
   - For every prerequisite edge, assign a criticality weight from 0.50 to 1.00:
     * 1.00 = Strictly mandatory direct prerequisite (e.g., Arrays -> Dynamic Arrays)
     * 0.85 = Essential architectural/algorithmic foundation
     * 0.50 to 0.70 = Helpful foundational background
   - Provide a concise 1-sentence reason (max 12 words) justifying why it is strictly required.

Return ONLY a valid JSON object matching this exact structure:
{{
  "prerequisites": {{
    "Candidate Topic Name": [
      {{
        "prerequisite": "Exact Candidate Prerequisite Name",
        "weight": 0.95,
        "reason": "Brief justification (max 12 words)"
      }}
    ]
  }}
}}
"""
    response_text = call_llm_fn(
        prompt,
        "You are a strict educational prerequisite analysis system. Output only valid JSON.",
    )
    parsed = parse_json_safely(response_text)

    raw_graph = {}
    if (
        isinstance(parsed, dict)
        and "prerequisites" in parsed
        and isinstance(parsed["prerequisites"], dict)
    ):
        raw_graph = parsed["prerequisites"]
    elif isinstance(parsed, dict):
        raw_graph = parsed

    # 2. Match and sanitize raw graph against candidate list
    detailed_graph: Dict[str, List[Dict[str, Any]]] = {}
    simple_graph: Dict[str, List[str]] = {}

    for cand in candidates_list:
        c_name = cand["topic"]
        detailed_graph[c_name] = []
        simple_graph[c_name] = []

    def resolve_candidate_name(raw_name: str) -> Optional[str]:
        if not raw_name:
            return None
        r_str = str(raw_name).strip()
        r_lower = r_str.lower()
        if r_lower in canonical_lookup:
            return canonical_lookup[r_lower]
        r_lex = canonicalize_lexical_name(r_str)
        if r_lex in lexical_lookup:
            return lexical_lookup[r_lex]
        return None

    for raw_topic, prereq_entries in raw_graph.items():
        topic_canonical = resolve_candidate_name(raw_topic)
        if not topic_canonical:
            continue

        if not isinstance(prereq_entries, list):
            if isinstance(prereq_entries, (str, dict)):
                prereq_entries = [prereq_entries]
            else:
                prereq_entries = []

        seen_prereqs = set()
        clean_entries: List[Dict[str, Any]] = []

        for entry in prereq_entries:
            p_name_raw = ""
            weight = 0.80
            reason = ""

            if isinstance(entry, dict):
                p_name_raw = str(entry.get("prerequisite") or entry.get("topic") or "").strip()
                try:
                    weight = float(entry.get("weight", 0.80))
                except (ValueError, TypeError):
                    weight = 0.80
                reason = str(entry.get("reason", "")).strip()
            elif isinstance(entry, str):
                p_name_raw = entry.strip()

            p_canonical = resolve_candidate_name(p_name_raw)
            if not p_canonical or p_canonical == topic_canonical:
                continue

            # Filter weak edges (< 0.50)
            if weight < 0.50:
                continue

            weight = min(1.0, max(0.50, weight))

            if p_canonical in seen_prereqs:
                # If duplicate in list, update weight if higher
                for existing in clean_entries:
                    if existing["prerequisite"] == p_canonical and weight > existing["weight"]:
                        existing["weight"] = weight
                        if reason:
                            existing["reason"] = reason
                continue

            seen_prereqs.add(p_canonical)
            clean_entries.append({
                "prerequisite": p_canonical,
                "weight": round(weight, 2),
                "reason": reason[:100],
            })

        # Cap at 4 prerequisites max, sorted by weight descending
        clean_entries.sort(key=lambda x: x["weight"], reverse=True)
        clean_entries = clean_entries[:4]

        detailed_graph[topic_canonical] = clean_entries
        simple_graph[topic_canonical] = [item["prerequisite"] for item in clean_entries]

    if return_details:
        return detailed_graph
    return simple_graph


def generate_prerequisite_graph_weighted(
    topics: Union[List[str], List[Dict[str, Any]]],
    doc_summary: str = "",
    call_llm_fn: Callable[[str, str], str] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """Helper that directly returns the weighted prerequisite graph with metadata."""
    return generate_prerequisite_graph(
        topics=topics,
        doc_summary=doc_summary,
        call_llm_fn=call_llm_fn,
        return_details=True,
    )
