"""Pinecone vector indexing, document hash tracking, and document deletion."""

import hashlib
import json
import os
import shutil
from typing import Any, Callable, Dict, List, Optional


def get_file_hash(filepath: str) -> str:
    """Computes the MD5 checksum of a file."""
    hasher = hashlib.md5()
    with open(filepath, "rb") as f:
        hasher.update(f.read())
    return hasher.hexdigest()


def load_processed_hashes(tracking_file: str) -> Dict[str, str]:
    """Loads previously indexed document hashes from processed_files.json."""
    if os.path.exists(tracking_file):
        try:
            with open(tracking_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_processed_hashes(tracking_file: str, hashes: Dict[str, str]) -> None:
    """Saves document hashes to processed_files.json."""
    try:
        with open(tracking_file, "w", encoding="utf-8") as f:
            json.dump(hashes, f, indent=4)
    except Exception as e:
        print(f"[Warning] Could not save tracking file: {e}")


def upload_vectors_to_pinecone(
    index,
    embeddings: List[Any],
    chunk_data: List[Dict[str, Any]],
    pdf_file: str,
    subject: str,
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> None:
    """Upserts chunk vectors and metadata into Pinecone, scoped by subject namespace."""
    if index is None:
        print("[Warning] Pinecone index is None. Skipping vector upload.")
        return

    if not subject or not str(subject).strip():
        raise ValueError("Subject is required to upload vectors to Pinecone.")
    clean_subj = str(subject).strip().upper()

    vectors_to_upsert = []
    total_vecs = len(embeddings)

    for i, embedding in enumerate(embeddings):
        vector = embedding.tolist() if hasattr(embedding, "tolist") else list(embedding)
        chunk = chunk_data[i]
        page_nums = chunk["page_numbers"]

        vectors_to_upsert.append(
            (
                f"{clean_subj}_{pdf_file}_{i}",
                vector,
                {
                    "sentence": chunk["text"],
                    "document": pdf_file,
                    "subject": clean_subj,
                    "chunk_index": i,
                    "page_numbers": json.dumps(page_nums),
                },
            )
        )

        if len(vectors_to_upsert) >= 100:
            index.upsert(vectors=vectors_to_upsert, namespace=clean_subj)
            vectors_to_upsert = []
            if progress_callback:
                progress_callback(i + 1, total_vecs)

    if vectors_to_upsert:
        index.upsert(vectors=vectors_to_upsert, namespace=clean_subj)
        if progress_callback:
            progress_callback(total_vecs, total_vecs)


def delete_document_data(
    filename: str,
    subject: str,
    pdf_dir: str = "",
    index=None,
    db=None,
) -> Dict[str, Any]:
    """Deletes a document from disk, MongoDB, vector index, and extracted images."""
    if not subject or not str(subject).strip():
        raise ValueError("Subject is required to delete document data.")
    clean_subj = str(subject).strip().upper()

    # 1. Remove file from uploads directory
    candidate_paths = [
        os.path.join(pdf_dir, subject.strip().lower(), "documents", filename) if subject else None,
        os.path.join(pdf_dir, subject.strip().upper(), "documents", filename) if subject else None,
        os.path.join(pdf_dir, subject.strip().lower(), filename) if subject else None,
        os.path.join(pdf_dir, subject.strip().upper(), filename) if subject else None,
        os.path.join(pdf_dir, filename),
    ]
    filepath = next((p for p in candidate_paths if p and os.path.isfile(p)), os.path.join(pdf_dir, filename))

    file_exists = os.path.isfile(filepath)
    if file_exists:
        os.remove(filepath)
        print(f"Removed file: {filepath}")

    # 2. Remove document record from MongoDB Atlas
    db_doc_deleted = False
    if db is not None:
        try:
            res = db.documents.delete_one({"name": filename, "subject": clean_subj})
            if res.deleted_count > 0:
                db_doc_deleted = True
                print(f"Removed document record for {filename} from MongoDB Atlas ({clean_subj}).")
        except Exception as e:
            print(f"Notice: could not delete MongoDB document for {filename}: {e}")

    # 2.1. Clean up prerequisites in MongoDB Atlas for this document
    if db is not None:
        try:
            from pathlib import Path
            doc_stem = Path(filename).stem
            del_prereq_res = db.prerequisites.delete_many(
                {
                    "subject": clean_subj,
                    "$or": [
                        {"document": filename},
                        {"document": doc_stem},
                        {"document": f"{doc_stem}.pdf"},
                    ],
                }
            )
            print(
                f"Removed {del_prereq_res.deleted_count} prerequisites for {filename} from MongoDB Atlas ({clean_subj})."
            )
        except Exception as e:
            print(f"Notice: could not delete MongoDB prerequisites for {filename}: {e}")

    # 3. Delete extracted images for this document
    from pathlib import Path
    stem = Path(filename).stem.replace(" ", "_")
    safe_name = filename.replace(" ", "_").replace(".", "_")
    image_dirs = list(dict.fromkeys([stem, safe_name]))

    if subject:
        for folder_name in image_dirs:
            subj_images_dir = os.path.join(
                pdf_dir, subject.strip().lower(), "images", folder_name
            )
            if os.path.exists(subj_images_dir):
                shutil.rmtree(subj_images_dir)
                print(f"Removed subject-isolated extracted images for {filename} ({subject}).")
            legacy_subj_dir = os.path.join(
                pdf_dir, "images", subject.strip().upper(), folder_name
            )
            if os.path.exists(legacy_subj_dir):
                shutil.rmtree(legacy_subj_dir)

    for folder_name in image_dirs:
        legacy_doc_images_dir = os.path.join(pdf_dir, "images", folder_name)
        if os.path.exists(legacy_doc_images_dir):
            shutil.rmtree(legacy_doc_images_dir)
            print(f"Removed legacy extracted images for {filename}.")

    # 4. Delete vectors from Pinecone scoped by subject namespace
    vectors_pruned = False
    if index is not None:
        try:
            del_filter = {"document": {"$eq": filename}}
            if subject:
                index.delete(filter=del_filter, namespace=subject)
            else:
                for ns in ["DSA", "ML", ""]:
                    try:
                        index.delete(filter=del_filter, namespace=ns)
                    except Exception:
                        pass
            vectors_pruned = True
            print(f"Pruned vectors for {filename} from Pinecone index (subject: {subject}).")
        except Exception as e:
            print(f"Warning deleting Pinecone vectors: {e}")

    if not file_exists and not db_doc_deleted and not vectors_pruned:
        raise FileNotFoundError(f"Document '{filename}' was not found in {clean_subj}.")

    return {
        "filename": filename,
        "file_deleted": file_exists,
        "vectors_pruned": vectors_pruned,
    }
