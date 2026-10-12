"""Image handler for course document diagrams.

Matches genuine diagrams extracted from course PDFs via PyMuPDF. Strictly
returns authentic diagrams from course materials when notes mode is selected.
"""

import json
import os
from typing import Any, Dict, List, Optional


class ImageHandler:
    """Finds genuine extracted diagrams from course PDFs relevant to RAG context."""

    def __init__(self, images_dir: str, hf_api_key: str = ""):
        self.images_dir = images_dir

    def find_document_images(
        self,
        matches: List[Any],
        top_k: int = 3,
        subject: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Given RAG matches (which carry page_numbers in metadata), looks up image_index.json for each matched document/page and returns relevant extracted PDF image entries.

        Supports both subject-scoped directories and legacy flat paths.
        """
        doc_pages: Dict[str, set] = {}
        for match in matches:
            meta = (
                match.get("metadata", {})
                if isinstance(match, dict)
                else getattr(match, "metadata", {})
            )
            doc_name = meta.get("document", "")
            page_numbers_raw = meta.get("page_numbers", "[]")
            if isinstance(page_numbers_raw, str):
                try:
                    page_numbers = json.loads(page_numbers_raw)
                except (json.JSONDecodeError, TypeError):
                    page_numbers = []
            elif isinstance(page_numbers_raw, list):
                page_numbers = page_numbers_raw
            else:
                page_numbers = []

            if doc_name and page_numbers:
                if doc_name not in doc_pages:
                    doc_pages[doc_name] = set()
                for p in page_numbers:
                    doc_pages[doc_name].add(int(p))

        if not doc_pages:
            return []

        found_images: List[Dict[str, Any]] = []
        from tutor.config import get_db
        db = get_db()

        for doc_name, pages in doc_pages.items():
            if not subject:
                continue
            clean_subj = str(subject).strip().upper()
            images_list: List[Dict[str, Any]] = []

            # 1. Primary: query MongoDB document record for extractedImages strictly within subject
            if db is not None:
                try:
                    doc = db.documents.find_one({"name": doc_name, "subject": clean_subj})
                    if not doc:
                        doc = db.documents.find_one({"name": doc_name, "subject": clean_subj.lower()})
                    if doc and doc.get("extractedImages"):
                        images_list = doc.get("extractedImages", [])
                except Exception as e:
                    print(f"[Notice] Could not query MongoDB for document images: {e}")

            # 2. Legacy fallback: check image_index.json on disk if MongoDB record is not yet populated
            if not images_list:
                from pathlib import Path
                stem = Path(doc_name).stem.replace(" ", "_")
                safe_name = doc_name.replace(" ", "_").replace(".", "_")
                index_path = None
                for folder in [stem, safe_name]:
                    if subject:
                        for s in [subject.strip().lower(), subject.strip().upper()]:
                            cand = os.path.join(self.images_dir, s, "images", folder, "image_index.json")
                            if os.path.exists(cand):
                                index_path = cand
                                break
                    if index_path:
                        break
                    cand_legacy = os.path.join(self.images_dir, "images", folder, "image_index.json")
                    if os.path.exists(cand_legacy):
                        index_path = cand_legacy
                        break

                if index_path and os.path.exists(index_path):
                    try:
                        with open(index_path, "r", encoding="utf-8") as f:
                            data = json.load(f)
                            images_list = data.get("images", [])
                    except Exception:
                        pass

            for img_entry in images_list:
                if img_entry.get("page_number") in pages:
                    stored_rel = img_entry.get("path", "")
                    img_path = os.path.join(self.images_dir, stored_rel)
                    if not os.path.isfile(img_path):
                        from pathlib import Path
                        safe_subj = str(subject).strip().lower() if subject else ""
                        if not safe_subj:
                            continue
                        alt_path = os.path.join(self.images_dir, safe_subj, "images", stem, img_entry.get("filename", ""))
                        if os.path.isfile(alt_path):
                            stored_rel = f"{safe_subj}/images/{stem}/{img_entry.get('filename', '')}"
                        else:
                            continue

                    found_images.append(
                        {
                            "url": f"/images/{stored_rel}",
                            "source": "document",
                            "document": doc_name,
                            "page": img_entry["page_number"],
                        }
                    )

        # Deduplicate and limit to top_k
        seen = set()
        unique: List[Dict[str, Any]] = []
        for img in found_images:
            key = img["url"]
            if key not in seen:
                seen.add(key)
                unique.append(img)

        return unique[:top_k]

    def get_images(
        self,
        matches: List[Any],
        user_question: Optional[str] = None,
        topic: Optional[str] = None,
        mode: str = "notes",
        subject: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Returns diagrams strictly according to the selected mode:

        - 'notes': ONLY genuine diagrams extracted from course PDFs. Zero fake fallbacks.
        - 'mermaid' / 'none': returns empty list (Mermaid is rendered interactively in chat).
        """
        if mode == "notes":
            return self.find_document_images(matches, top_k=3, subject=subject)
        return []
