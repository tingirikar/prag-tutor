"""Persists generated learning prerequisite graphs directly into MongoDB Atlas with cross-PDF deduplication and global DAG re-validation."""

import logging
from typing import Any, Dict, List, Optional, Union

from tutor.config import get_db
from tutor.prerequisite_processing.topic_extraction import (
    _compute_cosine_similarity,
    canonicalize_lexical_name,
)
from tutor.prerequisite_processing.validation import (
    _normalize_edge_entries,
    validate_and_sanitize_graph,
)

logger = logging.getLogger(__name__)


def _build_cross_document_synonym_map(
    new_topics: List[str], existing_topics: List[str]
) -> Dict[str, str]:
    """Maps new topics to existing canonical topics if they are lexical or semantic duplicates (>= 0.86)."""
    rename_map: Dict[str, str] = {t: t for t in new_topics}
    if not new_topics or not existing_topics:
        return rename_map

    # 1. Lexical matching
    existing_lex_map = {
        canonicalize_lexical_name(et): et for et in existing_topics
    }
    existing_lower_map = {et.lower(): et for et in existing_topics}

    unmatched_new: List[str] = []

    for nt in new_topics:
        nt_lower = nt.lower()
        if nt_lower in existing_lower_map:
            rename_map[nt] = existing_lower_map[nt_lower]
            continue

        nt_lex = canonicalize_lexical_name(nt)
        if nt_lex in existing_lex_map:
            rename_map[nt] = existing_lex_map[nt_lex]
            continue

        unmatched_new.append(nt)

    if not unmatched_new:
        return rename_map

    # 2. Semantic matching via SentenceTransformer embedding cosine similarity
    try:
        from tutor.config import get_embedding_model

        model = get_embedding_model()
        if model is not None:
            new_embs = model.encode(unmatched_new)
            exist_embs = model.encode(existing_topics)

            for idx, nt in enumerate(unmatched_new):
                best_sim = -1.0
                best_match = None
                for e_idx, et in enumerate(existing_topics):
                    sim = _compute_cosine_similarity(new_embs[idx], exist_embs[e_idx])
                    if sim > best_sim:
                        best_sim = sim
                        best_match = et

                if best_sim >= 0.86 and best_match:
                    logger.info(
                        "Cross-PDF semantic merge: mapped '%s' -> '%s' (similarity=%.3f)",
                        nt,
                        best_match,
                        best_sim,
                    )
                    rename_map[nt] = best_match
    except Exception as e:
        logger.debug("Semantic embedding comparison skipped in cross-PDF merge: %s", e)

    return rename_map


def save_prerequisites_to_mongodb(
    document_name: str,
    prerequisite_graph: Union[Dict[str, List[str]], Dict[str, List[Dict[str, Any]]]],
    subject: Optional[str] = None,
    db=None,
    first_seen_order: Optional[Dict[str, int]] = None,
    prerequisite_details: Optional[Dict[str, List[Dict[str, Any]]]] = None,
) -> int:
    """Saves generated topics and prerequisites into MongoDB Atlas with cross-PDF merging and DAG re-validation.

    Steps:
    1. Loads existing topics for the subject from MongoDB.
    2. Maps newly extracted candidate topics to existing canonical names if lexical/semantic duplicates (>= 0.86).
    3. Merges new edges with existing subject graph.
    4. Re-validates global subject graph (cycle breaking + transitive reduction).
    5. Saves both simple prerequisites [String] (sorted by criticality) and prerequisiteDetails / prerequisite_details.
    """
    if db is None:
        db = get_db()
    if db is None:
        logger.warning(
            "MongoDB Atlas is not accessible; cannot persist prerequisites."
        )
        return 0

    if not subject or not str(subject).strip():
        raise ValueError("Subject is required to persist prerequisites.")
    clean_subject = str(subject).strip().upper()

    # 1. Load existing subject topics from MongoDB Atlas
    existing_records = list(db.prerequisites.find({"subject": clean_subject}))
    existing_topics = [
        str(doc.get("topic", "")).strip()
        for doc in existing_records
        if str(doc.get("topic", "")).strip()
    ]

    # Normalize incoming graph data
    incoming_details = prerequisite_details or {}
    incoming_graph: Dict[str, List[Dict[str, Any]]] = {}

    for t, edges in prerequisite_graph.items():
        t_clean = str(t).strip()
        if not t_clean:
            continue
        if t_clean in incoming_details:
            incoming_graph[t_clean] = _normalize_edge_entries(incoming_details[t_clean])
        else:
            incoming_graph[t_clean] = _normalize_edge_entries(edges)

    # 2. Cross-PDF Synonym Mapping
    new_candidate_topics = list(incoming_graph.keys())
    rename_map = _build_cross_document_synonym_map(new_candidate_topics, existing_topics)

    # Remap incoming graph using canonical names
    remapped_incoming: Dict[str, List[Dict[str, Any]]] = {}
    incoming_order_map: Dict[str, int] = {}

    for raw_t, edges in incoming_graph.items():
        canonical_t = rename_map.get(raw_t, raw_t)
        remapped_edges: List[Dict[str, Any]] = []

        raw_order = (first_seen_order or {}).get(raw_t, len(remapped_incoming))
        if canonical_t not in incoming_order_map or raw_order < incoming_order_map[canonical_t]:
            incoming_order_map[canonical_t] = raw_order

        for e in edges:
            p_canonical = rename_map.get(e["prerequisite"], e["prerequisite"])
            if p_canonical != canonical_t:
                remapped_edges.append({
                    "prerequisite": p_canonical,
                    "weight": e["weight"],
                    "reason": e.get("reason", ""),
                })

        if canonical_t in remapped_incoming:
            # Merge edge list with existing remapped
            existing_dest = {e["prerequisite"]: e for e in remapped_incoming[canonical_t]}
            for ne in remapped_edges:
                dest = ne["prerequisite"]
                if dest in existing_dest:
                    existing_dest[dest]["weight"] = max(existing_dest[dest]["weight"], ne["weight"])
                else:
                    remapped_incoming[canonical_t].append(ne)
        else:
            remapped_incoming[canonical_t] = remapped_edges

    # 3. Combine existing subject graph with remapped incoming graph
    combined_graph: Dict[str, List[Dict[str, Any]]] = {}
    combined_orders: Dict[str, int] = {}
    document_map: Dict[str, str] = {}

    for doc in existing_records:
        ex_topic = str(doc.get("topic", "")).strip()
        if not ex_topic:
            continue
        ex_details = doc.get("prerequisiteDetails") or doc.get("prerequisite_details")
        if ex_details and isinstance(ex_details, list):
            norm_ex_edges = []
            for item in ex_details:
                if isinstance(item, dict) and item.get("topic"):
                    norm_ex_edges.append({
                        "prerequisite": item["topic"],
                        "weight": float(item.get("weight", 0.80)),
                        "reason": str(item.get("reason", "")),
                    })
        else:
            norm_ex_edges = _normalize_edge_entries(doc.get("prerequisites", []))

        combined_graph[ex_topic] = norm_ex_edges
        combined_orders[ex_topic] = int(doc.get("firstSeenOrder") or doc.get("first_seen_order") or len(combined_orders))
        document_map[ex_topic] = doc.get("document", document_name)

    # Merge newly remapped incoming edges
    for new_t, new_edges in remapped_incoming.items():
        document_map[new_t] = document_name
        if new_t in incoming_order_map:
            combined_orders[new_t] = incoming_order_map[new_t]
        elif new_t not in combined_orders:
            combined_orders[new_t] = len(combined_orders)

        if new_t in combined_graph:
            existing_dest = {e["prerequisite"]: e for e in combined_graph[new_t]}
            for ne in new_edges:
                dest = ne["prerequisite"]
                if dest in existing_dest:
                    existing_dest[dest]["weight"] = max(existing_dest[dest]["weight"], ne["weight"])
                    if ne.get("reason"):
                        existing_dest[dest]["reason"] = ne["reason"]
                else:
                    combined_graph[new_t].append(ne)
        else:
            combined_graph[new_t] = new_edges

    # 4. Run Global Subject DAG Re-Validation
    validated_detailed = validate_and_sanitize_graph(
        raw_graph=combined_graph,
        known_topics=list(combined_graph.keys()),
        first_seen_order=combined_orders,
        return_details=True,
    )

    # 5. Persist the updated subject graph to MongoDB Atlas
    inserted_count = 0
    for topic, edge_list in validated_detailed.items():
        t_str = str(topic).strip()
        if not t_str:
            continue

        p_list = [e["prerequisite"] for e in edge_list]
        details_list = [
            {
                "topic": e["prerequisite"],
                "weight": float(e["weight"]),
                "reason": str(e.get("reason", "")),
            }
            for e in edge_list
        ]
        order_val = combined_orders.get(t_str, 0)
        doc_source = document_map.get(t_str, document_name)

        db.prerequisites.update_one(
            {"subject": clean_subject, "topic": t_str},
            {
                "$set": {
                    "subject": clean_subject,
                    "topic": t_str,
                    "prerequisites": p_list,
                    "prerequisiteDetails": details_list,
                    "prerequisite_details": details_list,
                    "firstSeenOrder": order_val,
                    "first_seen_order": order_val,
                    "document": doc_source,
                    "isCustom": False,
                }
            },
            upsert=True,
        )
        inserted_count += 1

    logger.info(
        "Persisted %d unified prerequisite topics for subject %s in MongoDB Atlas.",
        inserted_count,
        clean_subject,
    )
    return inserted_count
