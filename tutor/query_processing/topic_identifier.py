"""5-layer topic identification from RAG results and MongoDB syllabus prerequisite lookups."""

import re
from typing import Any, Dict, List, Optional, Set

from tutor.config import get_db

STOP_WORDS = {
    "what",
    "when",
    "where",
    "which",
    "who",
    "whom",
    "this",
    "that",
    "these",
    "those",
    "am",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "having",
    "do",
    "does",
    "did",
    "doing",
    "a",
    "an",
    "the",
    "and",
    "but",
    "if",
    "or",
    "because",
    "as",
    "until",
    "while",
    "of",
    "at",
    "by",
    "for",
    "with",
    "about",
    "against",
    "between",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "to",
    "from",
    "up",
    "down",
    "in",
    "out",
    "on",
    "off",
    "over",
    "under",
    "again",
    "further",
    "then",
    "once",
    "here",
    "there",
    "all",
    "any",
    "both",
    "each",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "no",
    "nor",
    "not",
    "only",
    "own",
    "same",
    "so",
    "than",
    "too",
    "very",
    "can",
    "will",
    "just",
    "should",
    "now",
    "how",
    "determine",
    "implement",
    "efficiently",
    "explain",
    "describe",
    "difference",
    "between",
    "using",
    "used",
    "tell",
    "about",
}


def stem(w: str) -> str:
    """Lightweight rule-based suffix stemmer."""
    if w.endswith("ies"):
        return w[:-3] + "y"
    if w.endswith("es") and len(w) > 4:
        return w[:-2]
    if w.endswith("s") and len(w) > 3 and not w.endswith("ss"):
        return w[:-1]
    return w


def get_all_prerequisites_data(subject: Optional[str] = None) -> Dict[str, List[str]]:
    """Returns topics directly from MongoDB Atlas (scoped by subject if provided)."""
    if subject:
        return get_prerequisites_for_subject(subject)
    db = get_db()
    if db is None:
        return {}
    try:
        return {
            doc["topic"]: doc.get("prerequisites", [])
            for doc in db.prerequisites.find({}, {"topic": 1, "prerequisites": 1})
            if doc.get("topic")
        }
    except Exception as e:
        print(f"[Warning] Failed to fetch prerequisites from MongoDB: {e}")
        return {}


def get_prerequisites_for_subject(
    subject: Optional[str] = None,
) -> Dict[str, List[str]]:
    """Returns syllabus prerequisites strictly isolated to the given subject directly from MongoDB Atlas."""
    if not subject:
        return {}
    subj_key = str(subject).strip().upper()
    db = get_db()
    if db is None:
        return {}
    try:
        cursor = db.prerequisites.find(
            {"subject": subj_key}, {"topic": 1, "prerequisites": 1}
        )
        return {
            doc["topic"]: doc.get("prerequisites", [])
            for doc in cursor
            if doc.get("topic")
        }
    except Exception as e:
        print(
            f"[Warning] Failed to fetch {subj_key} prerequisites from MongoDB: {e}"
        )
        return {}


def get_documents_for_subject(subject: Optional[str] = None) -> Set[str]:
    """Fetch active document filenames for a given subject directly from MongoDB Atlas."""
    if not subject:
        return set()
    subj_key = str(subject).strip().upper()
    db = get_db()
    if db is None:
        return set()
    try:
        cursor = db.documents.find(
            {"subject": subj_key}, {"name": 1, "filename": 1, "_id": 0}
        )
        docs = set()
        for doc in cursor:
            doc_name = doc.get("name") or doc.get("filename")
            if doc_name:
                docs.add(doc_name)
        return docs
    except Exception as e:
        print(
            f"[Warning] Failed to fetch {subj_key} documents from MongoDB: {e}"
        )
        return set()


def identify_topic_from_rag(
    matches: List[Any],
    user_question: Optional[str] = None,
    subject: Optional[str] = None,
) -> Optional[str]:
    """Robust topic identification strategy:

    1. Exact phrase / substring in user question
    2. Stemmed token overlap in user question (handles singular/plural like 'heaps' -> 'Min Heaps')
    3. Explicit metadata attached to retrieved matches (verified for query relevance)
    4. Query-grounded context match across retrieved sentence chunks (rejects unrelated topics)
    5. Fallback clean topic extracted from the user question itself
    """
    subj_prereqs = get_prerequisites_for_subject(subject)
    if not subj_prereqs:
        return None

    sorted_topics = sorted(subj_prereqs.keys(), key=lambda x: len(x), reverse=True)
    q_lower = (user_question or "").lower()

    # Extract user content words (stemmed, including 2-letter acronyms like ml, ai, os, ip, db)
    q_words = {
        stem(w)
        for w in re.findall(r"\b[a-zA-Z]{2,}\b", q_lower)
        if stem(w) not in STOP_WORDS
    }

    # 1. Exact phrase / substring in user question
    if user_question:
        for t in sorted_topics:
            pattern = r"\b" + re.escape(t.lower()) + r"\b"
            if re.search(pattern, q_lower) or t.lower() in q_lower:
                return t

        # 2. Token overlap score with stemming in user question
        # Allow 1-word matches if q_words has 1-2 words (e.g. 'heaps', 'stacks', 'trees')
        min_matched = 1 if len(q_words) <= 2 else 2
        best_topic = None
        best_score = 0.0

        for t in sorted_topics:
            t_raw = re.findall(r"\b[a-zA-Z]{2,}\b", t.lower())
            t_words = [stem(w) for w in t_raw if stem(w) not in STOP_WORDS]
            if not t_words:
                continue
            matched = [w for w in t_words if w in q_words]
            if len(matched) >= min_matched:
                score = (len(matched) / len(t_words)) * (1.0 + 0.2 * len(matched))
                if score > best_score:
                    best_score = score
                    best_topic = t

        if best_topic and best_score >= 0.40:
            return best_topic

    # 3. Explicit metadata attached to retrieved matches (verified for query relevance)
    if matches and q_words:
        for match in matches:
            meta = (
                match.get("metadata", {})
                if isinstance(match, dict)
                else getattr(match, "metadata", {})
            )
            if isinstance(meta, dict):
                if (
                    subject
                    and meta.get("subject")
                    and str(meta["subject"]).strip().upper()
                    != subject.strip().upper()
                ):
                    continue
                for field in ["topic", "title"]:
                    val = str(meta.get(field, "")).strip()
                    if val in subj_prereqs:
                        # Guard: Require overlap with query keywords
                        if any(
                            stem(w) in q_words
                            for w in re.findall(r"\b[a-zA-Z]{2,}\b", val.lower())
                        ):
                            return val

    # 4. Context match: ONLY consider if matches exist AND has lexical overlap with user query keywords
    best_context_topic = None
    best_context_score = 0.0

    if matches and q_words:
        for match in matches:
            meta = (
                match.get("metadata", {})
                if isinstance(match, dict)
                else getattr(match, "metadata", {})
            )
            sentence = (
                meta.get("sentence", "") if isinstance(meta, dict) else ""
            ).lower()
            s_words = {
                stem(w)
                for w in re.findall(r"\b[a-zA-Z]{2,}\b", sentence)
                if stem(w) not in STOP_WORDS
            }

            for t in sorted_topics:
                t_raw = re.findall(r"\b[a-zA-Z]{2,}\b", t.lower())
                t_words = [stem(w) for w in t_raw if stem(w) not in STOP_WORDS]
                if not t_words:
                    continue

                # CRITICAL GUARD: Topic MUST overlap with user query keywords
                if not any(w in q_words for w in t_words):
                    continue

                matched = [w for w in t_words if w in s_words]
                if len(matched) >= 1:
                    score = len(matched) / len(t_words)
                    if score > best_context_score:
                        best_context_score = score
                        best_context_topic = t

    if best_context_topic and best_context_score >= 0.40:
        return best_context_topic

    # 5. Fallback clean topic extracted from the user question itself
    if user_question:
        clean_topic = re.sub(
            r"^(explain|what is|how do|tell me about|describe|define)\s+",
            "",
            q_lower,
            flags=re.IGNORECASE,
        ).strip()
        if clean_topic and len(clean_topic) >= 3:
            return clean_topic.title()

    return None


def get_prerequisites_for_topic(
    topic: Optional[str], subject: Optional[str] = None
) -> List[str]:
    """Retrieves prerequisites corresponding to the identified topic within the given subject."""
    if not topic:
        return []
    subj_prereqs = get_prerequisites_for_subject(subject)
    if not subj_prereqs:
        return []

    # 1. Exact match with non-empty prerequisites
    if topic in subj_prereqs and subj_prereqs[topic]:
        return list(subj_prereqs[topic])

    # 2. Case-insensitive match with non-empty prerequisites
    topic_lower = topic.strip().lower()
    for t, prereqs in subj_prereqs.items():
        if t.lower() == topic_lower and prereqs:
            return list(prereqs)

    # 3. Direct match was empty list: check if any related topic has foundational prerequisites
    topic_words = set(topic_lower.split()) - {
        "concept",
        "introduction",
        "overview",
        "definition",
        "fundamentals",
        "basics",
        "and",
        "or",
        "in",
        "of",
        "algorithm",
        "cases",
    }
    for t, prereqs in subj_prereqs.items():
        if prereqs and any(w in t.lower() for w in topic_words if len(w) > 4):
            return list(prereqs)

    # 4. Fall back to direct match if it exists
    if topic in subj_prereqs:
        return list(subj_prereqs[topic])
    for t, prereqs in subj_prereqs.items():
        if t.lower() == topic_lower:
            return list(prereqs)

    return []



def get_prerequisite_details_for_topic(
    topic: Optional[str], subject: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Retrieves rich prerequisite details (topic, weight, reason) for a given topic from MongoDB Atlas."""
    if not topic:
        return []
    db = get_db()
    if db is None:
        return []

    subj_key = str(subject).strip().upper() if subject else None
    query: Dict[str, Any] = {}
    if subj_key:
        query["subject"] = subj_key

    clean_topic = topic.strip()
    escaped = re.escape(clean_topic)
    query["topic"] = {"$regex": f"^{escaped}$", "$options": "i"}

    try:
        doc = db.prerequisites.find_one(query)
        if doc:
            details = doc.get("prerequisiteDetails") or doc.get("prerequisite_details")
            if isinstance(details, list) and details:
                return details
            prereqs = doc.get("prerequisites", [])
            return [
                {"topic": p, "weight": max(0.50, 1.0 - 0.05 * i), "reason": ""}
                for i, p in enumerate(prereqs)
            ]
    except Exception as e:
        print(f"[Warning] Failed to fetch prerequisite details for {topic}: {e}")

    return []

