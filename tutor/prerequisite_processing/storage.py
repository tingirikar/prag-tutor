"""Persists generated learning prerequisite graphs directly into MongoDB Atlas."""

import logging
from typing import Dict, List, Optional

from tutor.config import get_db

logger = logging.getLogger(__name__)


def save_prerequisites_to_mongodb(
    document_name: str,
    prerequisite_graph: Dict[str, List[str]],
    subject: Optional[str] = None,
    db=None,
) -> int:
    """Saves the generated topics and prerequisites directly into MongoDB Atlas.

    Strictly isolated per subject.
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
    inserted_count = 0

    for topic, prereqs in prerequisite_graph.items():
        t_str = str(topic).strip()
        if not t_str:
            continue
        p_list = [str(p).strip() for p in prereqs if str(p).strip()]
        db.prerequisites.update_one(
            {"subject": clean_subject, "topic": t_str},
            {
                "$set": {
                    "subject": clean_subject,
                    "topic": t_str,
                    "prerequisites": p_list,
                    "document": document_name,
                    "isCustom": False,
                }
            },
            upsert=True,
        )
        inserted_count += 1

    return inserted_count
