"""Candidate topic extraction from textbook excerpts, name normalization, and semantic deduplication."""

import json
import logging
import math
import re
from typing import Any, Callable, Dict, List, Optional, Tuple

from tutor.prerequisite_processing.text_cleaning import (
    split_text_into_representative_windows,
)

logger = logging.getLogger(__name__)

ACRONYM_PATTERN = re.compile(r"\b[A-Z0-9]{2,5}\b")

BOILERPLATE_NOISE_SET = {
    "introduction",
    "overview",
    "summary",
    "conclusion",
    "table of contents",
    "index",
    "syllabus",
    "unit",
    "chapter",
    "section",
    "exercise",
    "exercises",
    "references",
    "appendix",
    "author",
    "authors",
    "title",
    "s.no",
    "question",
    "questions",
    "solution",
    "solutions",
    "example",
    "examples",
    "notes",
    "note",
    "page",
    "lecture",
    "homework",
    "lab",
    "course",
    "prerequisite",
    "prerequisites",
}

VAGUE_SINGLE_WORDS = {
    "data",
    "system",
    "systems",
    "method",
    "methods",
    "analysis",
    "analyses",
    "concept",
    "concepts",
    "information",
    "process",
    "processes",
    "algorithm",
    "algorithms",
    "problem",
    "problems",
    "theory",
    "theories",
    "technique",
    "techniques",
    "approach",
    "approaches",
    "model",
    "models",
    "type",
    "types",
    "structure",
    "structures",
    "function",
    "functions",
    "code",
    "program",
    "programming",
    "implementation",
    "introduction",
    "definition",
    "application",
    "applications",
    "overview",
}


def parse_json_safely(text: str) -> Any:
    """Extracts and parses JSON from text, handling markdown code fences and minor syntax anomalies."""
    if not text:
        return None
    text = text.strip()
    # Find json block inside ```json ... ``` or ``` ... ```
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    if fence_match:
        text = fence_match.group(1).strip()

    # If text still contains non-json wrappers, find outermost { ... } or [ ... ]
    if not (text.startswith("{") or text.startswith("[")):
        bracket_match = re.search(r"([\{\[][\s\S]*[\}\]])", text)
        if bracket_match:
            text = bracket_match.group(1).strip()

    # Try direct json parse
    try:
        return json.loads(text)
    except Exception:
        pass

    # Attempt basic repairs: remove trailing commas before } or ]
    repaired = re.sub(r",\s*([\}\]])", r"\1", text)
    try:
        return json.loads(repaired)
    except Exception:
        pass

    # Attempt repair for truncated JSON by closing open quotes and braces
    try:
        last_quote = text.rfind('"')
        if last_quote > 0:
            trimmed = text[: last_quote + 1]
            open_braces = max(0, trimmed.count("{") - trimmed.count("}"))
            open_brackets = max(0, trimmed.count("[") - trimmed.count("]"))
            repaired_trunc = trimmed + ("]" * open_brackets) + ("}" * open_braces)
            return json.loads(repaired_trunc)
    except Exception:
        pass

    logger.warning("Failed to parse JSON response safely.")
    return None


def clean_to_title_case(name: str) -> str:
    """Normalizes word casing to Title Case while preserving standard acronyms (e.g. BST, AVL, DFS)."""
    words = name.split()
    formatted = []
    standard_acronyms = {
        "bst", "avl", "dfs", "bfs", "dsa", "sql", "api", "tcp", "udp",
        "ip", "os", "ml", "ai", "dag", "bkt", "cpu", "ram", "gpu", "http",
    }
    for w in words:
        clean_w = re.sub(r"[^\w]", "", w)
        if 2 <= len(clean_w) <= 5 and (clean_w.isupper() or clean_w.lower() in standard_acronyms):
            formatted.append(re.sub(r"[a-zA-Z0-9]+", lambda m: m.group(0).upper(), w))
        else:
            formatted.append(w.capitalize())
    return " ".join(formatted)



def normalize_topic_name(topic: str) -> str:
    """Normalizes topic names: strips numbering, trims extra punctuation, and standardizes casing."""
    t = str(topic or "").strip()
    # Remove leading numbering like "1. ", "1.2 ", "Unit 1: ", "Chapter 2 - ", "Section 3.1: "
    t = re.sub(
        r"^(unit\s+[ivx\d]+|chapter\s+\d+|section\s+\d+(\.\d+)*|\d+(\.\d+)*)\s*[:\-\.]?\s*",
        "",
        t,
        flags=re.IGNORECASE,
    ).strip()
    # Strip remaining leading punctuation/dashes
    t = t.lstrip(":-. ").strip()
    # Remove trailing periods or colons
    t = re.sub(r"[:\.]+$", "", t).strip()
    # Collapse multiple whitespace
    t = re.sub(r"\s+", " ", t)

    if not t:
        return ""

    return clean_to_title_case(t)


def canonicalize_lexical_name(topic: str) -> str:
    """Produces a canonical lower-case key for lexical matching by stripping articles, parens, and plurals."""
    t = str(topic or "").strip().lower()
    # Remove parentheses and contents, e.g., (bst), (dfs)
    t = re.sub(r"\([^)]*\)", "", t).strip()
    # Remove leading articles
    t = re.sub(r"^(a|an|the)\s+", "", t).strip()
    # Replace dashes/underscores with space
    t = re.sub(r"[\-_\/\\]+", " ", t)
    # Remove non-alphanumeric except spaces
    t = re.sub(r"[^\w\s]", "", t).strip()
    # Collapse spaces
    t = re.sub(r"\s+", " ", t)

    # Basic suffix/plural reduction (preserve words where trailing 's' is part of the root)
    protected = {"analysis", "basis", "status", "physics", "series", "species", "process"}
    words = t.split()
    stemmed_words = []
    for w in words:
        if w in protected:
            stemmed_words.append(w)
        elif w.endswith("ies") and len(w) > 4:
            stemmed_words.append(w[:-3] + "y")
        elif w.endswith("ees") and len(w) > 3:
            stemmed_words.append(w[:-1])
        elif w.endswith("es") and len(w) > 4 and not w.endswith("sses"):
            if w.endswith(("ches", "shes", "xes", "zes", "sses")):
                stemmed_words.append(w[:-2])
            else:
                stemmed_words.append(w[:-1])
        elif w.endswith("s") and len(w) > 3 and not w.endswith("ss"):
            stemmed_words.append(w[:-1])
        else:
            stemmed_words.append(w)

    return " ".join(stemmed_words)



def is_noise_or_vague_topic(topic: str) -> bool:
    """Checks whether a topic is an administrative boilerplate term or an overly vague standalone word."""
    norm = normalize_topic_name(topic)
    if not norm or len(norm) < 2:
        return True

    lower = norm.lower()
    if lower in BOILERPLATE_NOISE_SET:
        return True

    words = lower.split()
    # If it's a single word and in the vague/noise sets
    if len(words) == 1 and (words[0] in VAGUE_SINGLE_WORDS or words[0] in BOILERPLATE_NOISE_SET):
        return True

    # Drop single words shorter than 3 letters unless recognized acronyms
    if len(words) == 1 and len(words[0]) < 3 and not norm.isupper():
        return True

    return False


def _compute_cosine_similarity(vec1, vec2) -> float:
    """Computes cosine similarity between two 1D vectors."""
    try:
        import numpy as np

        v1 = np.asarray(vec1, dtype=float)
        v2 = np.asarray(vec2, dtype=float)
        norm1 = np.linalg.norm(v1)
        norm2 = np.linalg.norm(v2)
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return float(np.dot(v1, v2) / (norm1 * norm2))
    except Exception:
        # Fallback pure python dot product
        dot = sum(a * b for a, b in zip(vec1, vec2))
        norm1 = math.sqrt(sum(a * a for a in vec1))
        norm2 = math.sqrt(sum(b * b for b in vec2))
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return float(dot / (norm1 * norm2))


def deduplicate_and_filter_topics_with_metadata(
    raw_topics: List[Dict[str, Any]], max_topics: int = 35
) -> List[Dict[str, Any]]:
    """Merges candidate topics if lexical canonical names match or embedding cosine similarity >= 0.86.

    Preserves the cleaner canonical name, non-empty context hint, and earlier first_seen_order.
    Re-indexes first_seen_order from 0 to N-1.
    """
    if not raw_topics:
        return []

    # 1. Clean, normalize, and filter noise
    valid_candidates: List[Dict[str, Any]] = []
    for item in raw_topics:
        topic_name = str(item.get("topic", "")).strip()
        if not topic_name or is_noise_or_vague_topic(topic_name):
            continue
        clean_name = normalize_topic_name(topic_name)
        if not clean_name or is_noise_or_vague_topic(clean_name):
            continue

        first_seen = int(item.get("first_seen_order", len(valid_candidates)))
        context_hint = str(item.get("context_hint", "")).strip()
        # Trim context hint to max 15 words
        hint_words = context_hint.split()
        if len(hint_words) > 15:
            context_hint = " ".join(hint_words[:15])

        valid_candidates.append({
            "topic": clean_name,
            "first_seen_order": first_seen,
            "context_hint": context_hint,
            "lexical_key": canonicalize_lexical_name(clean_name),
        })

    if not valid_candidates:
        return []

    # 2. Precompute embeddings for semantic deduplication if embedding model is available
    embeddings = None
    try:
        from tutor.config import get_embedding_model

        model = get_embedding_model()
        if model is not None:
            names = [c["topic"] for c in valid_candidates]
            embeddings = model.encode(names)
    except Exception as e:
        logger.debug("Embedding model unavailable for topic deduplication: %s", e)

    # 3. Cluster / Merge duplicates
    clusters: List[List[Dict[str, Any]]] = []

    for idx, cand in enumerate(valid_candidates):
        matched_cluster = None
        cand_emb = embeddings[idx] if embeddings is not None else None

        for cluster in clusters:
            # Check against representative of the cluster (first member)
            rep = cluster[0]
            # Lexical match
            if cand["lexical_key"] and cand["lexical_key"] == rep["lexical_key"]:
                matched_cluster = cluster
                break

            # Semantic match
            if cand_emb is not None and rep.get("_emb") is not None:
                sim = _compute_cosine_similarity(cand_emb, rep["_emb"])
                if sim >= 0.86:
                    matched_cluster = cluster
                    break

        if matched_cluster is not None:
            cand["_emb"] = cand_emb
            matched_cluster.append(cand)
        else:
            cand["_emb"] = cand_emb
            clusters.append([cand])

    # 4. Form canonical entry for each cluster
    merged_topics: List[Dict[str, Any]] = []
    for cluster in clusters:
        # Pick cleanest canonical name: prefer title case and richer non-trivial length
        def score_name(item):
            name = item["topic"]
            has_acronym = bool(re.search(r"\([A-Z0-9]+\)", name))
            is_title = name.istitle() or bool(re.search(r"[A-Z]{2,}", name))
            lower_name = name.lower()
            is_plural = lower_name.endswith("s") and not lower_name.endswith("ss") and lower_name not in {"linked lists", "arrays", "data structures"}
            prefer_singular = not is_plural
            return (has_acronym, prefer_singular, is_title, len(name.split()), len(name))


        best_item = max(cluster, key=score_name)
        canonical_name = best_item["topic"]
        earliest_order = min(item["first_seen_order"] for item in cluster)

        # Pick best context hint
        hints = [item["context_hint"] for item in cluster if item.get("context_hint")]
        best_hint = hints[0] if hints else ""

        merged_topics.append({
            "topic": canonical_name,
            "first_seen_order": earliest_order,
            "context_hint": best_hint,
        })

    # Sort primarily by first_seen_order so chronological textbook flow is preserved
    merged_topics.sort(key=lambda t: t["first_seen_order"])

    if len(merged_topics) > max_topics:
        merged_topics = merged_topics[:max_topics]

    # Re-index first_seen_order strictly from 0 to N-1
    for rank, item in enumerate(merged_topics):
        item["first_seen_order"] = rank

    return merged_topics


def deduplicate_and_filter_topics(
    raw_topics: List[str], max_topics: int = 35
) -> List[str]:
    """Backward-compatible helper: normalizes and deduplicates topic strings."""
    topics_with_meta = [
        {"topic": str(t).strip(), "first_seen_order": idx, "context_hint": ""}
        for idx, t in enumerate(raw_topics)
        if str(t).strip()
    ]
    deduped = deduplicate_and_filter_topics_with_metadata(
        topics_with_meta, max_topics=max_topics
    )
    return [d["topic"] for d in deduped]


PEDAGOGICAL_CONCEPT_EXTRACTION_PROMPT = """Analyze the educational document excerpt below and identify ONLY core, teachable academic or technical concepts covered.

STRICT PEDAGOGICAL GUIDELINES:
1. STANDALONE & TEACHABLE CONCEPTS ONLY:
   - Extract major concepts, data structures, algorithms, theorems, laws, protocols, or methodologies that a student must learn and understand (e.g., "Binary Search Tree", "Dynamic Programming", "Dijkstra's Algorithm", "Newton's Second Law").
2. STRICTLY FORBIDDEN BOILERPLATE & NOISE:
   - FORBIDDEN: Document structural terms, headings, or metadata: "Introduction", "Overview", "Summary", "Conclusion", "Chapter 2", "Unit 1", "Section 3.4", "Exercises", "References", "Appendix", "Table of Contents", "Example 1.1", "Notes".
   - FORBIDDEN: Author, university, publisher, or course administrative names.
   - FORBIDDEN: Overly vague, generic, or non-teachable single words: "Data", "System", "Method", "Analysis", "Concept", "Information", "Process", "Algorithm", "Problem".
3. CANONICAL NAMING & FORMAT:
   - Standardize concept names into clean Title Case canonical nouns (e.g., "AVL Tree", "Breadth-First Search", "Bubble Sort").
   - Prefer singular form unless standard plural (e.g., "Linked Lists"). Include common standard acronyms in parentheses only if standard (e.g., "Binary Search Tree (BST)").
4. 1-LINE CONTEXT HINT:
   - For each concept, provide a concise 1-line context hint (max 15 words) describing what the concept means in this document.

Document Excerpt:
----------------------------------------
{chunk_text}
----------------------------------------

Return ONLY a valid JSON array of objects matching this exact structure:
[
  {{
    "topic": "Canonical Concept Name",
    "context_hint": "Brief 1-sentence description of the concept in this document (max 15 words)"
  }}
]
"""


def extract_topics_with_metadata(
    text: str, call_llm_fn: Callable[[str, str], str]
) -> List[Dict[str, Any]]:
    """Extracts candidate concepts with approximate position order and context hints across full document text.

    If text exceeds single-window limit, splits into representative windows so the entire document is covered.
    """
    if not text or not text.strip():
        return []

    windows = split_text_into_representative_windows(text, max_windows=4, window_chars=7000)
    all_raw_topics: List[Dict[str, Any]] = []

    lower_full_text = text.lower()

    for w_idx, win in enumerate(windows):
        prompt = PEDAGOGICAL_CONCEPT_EXTRACTION_PROMPT.format(chunk_text=win[:7000])
        response_text = call_llm_fn(
            prompt,
            "You are an expert curriculum topic extraction engine. Output only valid JSON arrays.",
        )
        parsed = parse_json_safely(response_text)

        if isinstance(parsed, list):
            for item in parsed:
                topic_str = ""
                hint_str = ""
                if isinstance(item, dict):
                    topic_str = str(item.get("topic") or item.get("name") or "").strip()
                    hint_str = str(item.get("context_hint") or item.get("hint") or "").strip()
                elif isinstance(item, (str, int)):
                    topic_str = str(item).strip()

                if not topic_str or is_noise_or_vague_topic(topic_str):
                    continue

                # Locate approximate character appearance position in full text
                clean_name = normalize_topic_name(topic_str)
                pos = lower_full_text.find(clean_name.lower())
                if pos == -1:
                    # Fallback to window order
                    pos = w_idx * 100000 + len(all_raw_topics)

                all_raw_topics.append({
                    "topic": clean_name,
                    "first_seen_order": pos,
                    "context_hint": hint_str,
                })

    if not all_raw_topics:
        return []

    # Sort by character position to establish chronological document order
    all_raw_topics.sort(key=lambda x: x["first_seen_order"])

    # Deduplicate and filter noise
    deduped = deduplicate_and_filter_topics_with_metadata(all_raw_topics)
    return deduped


def extract_candidate_topics_from_chunk(
    chunk_text: str, call_llm_fn: Callable[[str, str], str]
) -> List[str]:
    """Backward-compatible helper: extracts candidate educational concepts from a text chunk via LLM."""
    topics_with_meta = extract_topics_with_metadata(chunk_text, call_llm_fn)
    return [item["topic"] for item in topics_with_meta]
