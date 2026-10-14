"""Pinecone vector similarity search with strict subject namespace isolation and active document verification."""

import os
from typing import Any, List, Optional

from tutor.query_processing.topic_identifier import get_documents_for_subject


def is_active_document(
    document_name: Optional[str],
    subject: Optional[str] = None,
    documents_dir: Optional[str] = None,
) -> bool:
    """Prevent stale vector records or cross-subject documents from being used."""
    if not document_name:
        return False
    doc_base = os.path.basename(document_name)

    # 1. Subject isolation check via MongoDB Atlas
    if subject:
        subj_key = str(subject).strip().upper()
        allowed = get_documents_for_subject(subj_key)
        if allowed and doc_base not in allowed:
            return False

    # 2. Physical disk verification
    if documents_dir:
        candidates = [
            os.path.join(documents_dir, doc_base),
            os.path.join(documents_dir, "documents", doc_base),
        ]
        if subject:
            subj_lower = str(subject).strip().lower()
            subj_upper = str(subject).strip().upper()
            candidates.insert(
                0,
                os.path.join(
                    documents_dir, subj_lower, "documents", doc_base
                ),
            )
            candidates.insert(
                1,
                os.path.join(
                    documents_dir, subj_upper, "documents", doc_base
                ),
            )
            candidates.insert(
                2,
                os.path.join(
                    documents_dir, subj_lower, doc_base
                ),
            )
            candidates.insert(
                3,
                os.path.join(
                    documents_dir, subj_upper, doc_base
                ),
            )

        exists_on_disk = any(os.path.isfile(c) for c in candidates)
        if not exists_on_disk:
            return False

    return True


def active_document_names(
    subject: Optional[str] = None,
    documents_dir: Optional[str] = None,
) -> List[str]:
    """Returns sorted list of valid PDF document filenames for the specified subject."""
    if subject:
        subj_key = str(subject).strip().upper()
        mongo_docs = get_documents_for_subject(subj_key)
        if mongo_docs:
            return sorted(mongo_docs)

    if not documents_dir or not os.path.isdir(documents_dir):
        return []

    search_dirs = [documents_dir]
    if subject:
        subj_lower = os.path.join(documents_dir, str(subject).strip().lower())
        if os.path.isdir(subj_lower):
            search_dirs.append(subj_lower)
        subj_docs = os.path.join(subj_lower, "documents")
        if os.path.isdir(subj_docs):
            search_dirs.append(subj_docs)

    all_pdfs = set()
    for d in search_dirs:
        if os.path.isdir(d):
            for name in os.listdir(d):
                if name.lower().endswith(".pdf") and os.path.isfile(
                    os.path.join(d, name)
                ):
                    all_pdfs.add(name)

    return sorted(all_pdfs)


def fetch_answer(
    index,
    query_embedding: Any,
    top_k: int = 5,
    subject: Optional[str] = None,
    documents_dir: Optional[str] = None,
    min_score: float = 0.45,
) -> List[Any]:
    """Queries Pinecone for semantic chunks isolated by subject namespace and filters by minimum relevance threshold."""
    if index is None:
        return []

    if hasattr(query_embedding, "tolist"):
        query_embedding = query_embedding.tolist()

    query_params = {
        "vector": query_embedding,
        "top_k": top_k,
        "include_metadata": True,
    }
    subj_key = (subject or "").strip().upper() if subject else ""
    if subj_key:
        query_params["namespace"] = subj_key

    try:
        results = index.query(**query_params)
    except Exception as err:
        print(f"[Warning] Pinecone query in namespace '{subj_key}' failed: {err}")
        return []

    # Filter matches that meet the minimum relevance threshold, contain text, and belong to this subject
    matches = results.get("matches", [])
    valid_matches = [
        m
        for m in matches
        if float(m.get("score") if isinstance(m, dict) else getattr(m, "score", 0.0) or 0.0) >= min_score
        and len((m.get("metadata", {}).get("sentence") or "").strip()) > 5
        and is_active_document(
            m.get("metadata", {}).get("document"),
            subject=subj_key,
            documents_dir=documents_dir,
        )
    ]
    return valid_matches
