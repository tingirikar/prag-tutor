"""FastAPI controller for the PRAG-TUTOR Python RAG service.

Routes incoming HTTP requests to dedicated document and query processing pipelines.
"""

import json
import os
import queue
import sys
import threading
from pathlib import Path
from typing import Any, Dict, Optional

# Ensure repository root is in sys.path regardless of execution working directory (e.g. AWS PM2 cwd)
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse

from tutor.config import UPLOAD_DIR, get_embedding_model
from tutor.document_processing import DocumentProcessor
from tutor.query_processing import (
    ImageHandler,
    QueryProcessor,
    ResponseGenerator,
)
from tutor.learner_modelling import (
    DEFAULT_P_GUESS,
    DEFAULT_P_LEARN,
    DEFAULT_P_SLIP,
    MASTERY_THRESHOLD,
    compute_effective_mastery,
    diagnose_wrong_answer,
    update_bkt_sequence,
    update_stability,
)
from tutor.schemas import (
    BKTUpdateRequest,
    BKTUpdateResponse,
    DocumentRequest,
    IndexRequest,
    ImageRequest,
    MisconceptionDiagnosisRequest,
    MisconceptionDiagnosisResponse,
    QueryRequest,
)

app = FastAPI(title="LPITutor Python RAG Service")

# ── Service Pipeline Instances ─────────────────────────────────────────
print("Initializing Python RAG service pipelines...")
query_processor = QueryProcessor()
embedding_model = get_embedding_model()

try:
    document_processor = DocumentProcessor(pdf_dir=UPLOAD_DIR)
except Exception as error:
    print(f"[Warning] Failed to initialize document processor: {error}")
    document_processor = None

try:
    response_generator = ResponseGenerator(documents_dir=UPLOAD_DIR)
except Exception as error:
    print(f"[Warning] Failed to initialize response generator: {error}")
    response_generator = None

try:
    image_handler = ImageHandler(images_dir=UPLOAD_DIR)
except Exception as error:
    print(f"[Warning] Failed to initialize image handler: {error}")
    image_handler = None


# ── Static Image Serving ───────────────────────────────────────────────
@app.get("/images/{image_path:path}")
def serve_image(image_path: str):
    """Serves isolated subject images (uploads/{subject}/images/...) as well as legacy image paths."""
    if ".." in image_path:
        raise HTTPException(status_code=400, detail="Invalid image path")

    # 1. Exact relative path inside UPLOAD_DIR
    candidate = os.path.join(UPLOAD_DIR, image_path)
    if os.path.isfile(candidate):
        return FileResponse(candidate)

    # 2. Check if path was formatted without 'images/'
    parts = image_path.strip("/").split("/")
    if len(parts) >= 2 and parts[1].lower() != "images":
        subj = parts[0]
        rest = parts[1:]
        candidate_with_images = os.path.join(UPLOAD_DIR, subj, "images", *rest)
        if os.path.isfile(candidate_with_images):
            return FileResponse(candidate_with_images)

    # 3. Legacy flat uploads/images/ candidate
    legacy_candidate = os.path.join(UPLOAD_DIR, "images", image_path)
    if os.path.isfile(legacy_candidate):
        return FileResponse(legacy_candidate)

    raise HTTPException(status_code=404, detail="Image not found")


# ── Health & Diagnostics ───────────────────────────────────────────────
@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "embedding_model": embedding_model is not None,
        "response_generator": response_generator is not None,
        "document_processor": document_processor is not None,
        "image_handler": image_handler is not None,
        "prerequisite_topics": (
            len(response_generator.prerequisites_data) if response_generator else 0
        ),
    }


# ── RAG Tutoring Endpoints ─────────────────────────────────────────────
@app.get("/rag/prerequisites")
def prerequisites(
    subject: str = Query(..., min_length=1),
) -> Dict[str, Any]:
    if not response_generator:
        raise HTTPException(
            status_code=503, detail="Response generator is unavailable."
        )
    clean_subj = subject.strip().upper()
    data = response_generator.get_prerequisites_for_subject(clean_subj)
    return {
        "subject": clean_subj,
        "prerequisites": data,
        "count": len(data),
    }


@app.get("/rag/sample-questions")
def sample_questions(
    subject: str = Query(..., min_length=1),
    seed: str = Query(default=""),
) -> Dict[str, Any]:
    if not response_generator:
        raise HTTPException(
            status_code=503, detail="Response generator is unavailable."
        )
    clean_subj = subject.strip().upper()
    return {
        "subject": clean_subj,
        "questions": response_generator.generate_sample_questions(
            seed, subject=clean_subj
        ),
    }


@app.post("/rag/query")
async def query(request: QueryRequest) -> Dict[str, Any]:
    if not embedding_model:
        raise HTTPException(
            status_code=503,
            detail="Embedding model is unavailable. Check server logs for details.",
        )
    if not response_generator:
        raise HTTPException(
            status_code=503,
            detail="Response generator is unavailable. Configure PINECONE_API_KEY and GROQ_API_KEY.",
        )

    try:
        processed = query_processor.process_query(
            request.query,
            request.level.lower(),
            learner_profile=request.learner_profile,
        )
        search_query = query_processor.condense_query(
            processed["query"],
            history=request.history,
            subject=request.subject,
            groq_client=response_generator.groq_client if response_generator else None,
        )
        query_embedding = embedding_model.encode(search_query)
        result = response_generator.respond_to_user(
            query_embedding,
            processed["level"],
            user_question=request.query,
            topic=request.topic,
            conversation_history=request.history,
            preferred_model=request.model,
            provider=request.provider,
            subject=request.subject,
            image_mode=request.image_mode,
            mastered_topics=request.mastered_topics,
            learner_profile=request.learner_profile,
        )
        response_text = getattr(result, "response", str(result))

        # Multi-modal: fetch genuine PDF diagrams only if requested and notes mode is active
        images = []
        if (
            request.include_image
            and request.image_mode == "notes"
            and image_handler
        ):
            matches = response_generator.fetch_answer(
                query_embedding, top_k=5, subject=request.subject
            )
            images = image_handler.get_images(
                matches=matches,
                user_question=request.query,
                topic=getattr(result, "topic", None),
                mode="notes",
                subject=request.subject,
            )

        return {
            "response": response_text,
            "answer": response_text,
            "topic": getattr(result, "topic", None),
            "prerequisites": getattr(result, "prerequisites", []),
            "sources": getattr(result, "sources", []),
            "images": images,
            "model": getattr(
                result, "model", request.model or "openai/gpt-oss-20b"
            ),
            "provider": getattr(result, "provider", request.provider or "groq"),
        }
    except Exception as error:
        raise HTTPException(
            status_code=500, detail=f"Failed to generate response: {error}"
        ) from error


@app.get("/rag/models")
def get_available_models() -> Dict[str, Any]:
    """Return available online (Groq) and local (Ollama) LLM models."""
    cloud_models = [
        {
            "id": "qwen/qwen3.8-27b",
            "name": "Qwen 3.8 27B (Default)",
            "provider": "groq",
            "badge": "Cloud (Groq)",
        },
        {
            "id": "openai/gpt-oss-120b",
            "name": "GPT-OSS 120B",
            "provider": "groq",
            "badge": "Cloud (Groq)",
        },
        {
            "id": "openai/gpt-oss-20b",
            "name": "GPT-OSS 20B",
            "provider": "groq",
            "badge": "Cloud (Groq)",
        },
    ]

    local_models = []
    ollama_online = False
    if response_generator:
        try:
            import requests as req

            r = req.get(f"{response_generator.ollama_url}/api/tags", timeout=1.5)
            if r.status_code == 200:
                ollama_online = True
                for item in r.json().get("models", []):
                    m_name = item.get("name", "")
                    if m_name:
                        local_models.append(
                            {
                                "id": m_name,
                                "name": m_name,
                                "provider": "local",
                                "badge": "Local (Ollama)",
                            }
                        )
        except Exception:
            pass

    if not local_models:
        default_local = (
            getattr(response_generator, "ollama_model", "llama3.2:3b")
            if response_generator
            else "llama3.2:3b"
        )
        local_models.append(
            {
                "id": default_local,
                "name": default_local,
                "provider": "local",
                "badge": "Local (Ollama)",
            }
        )

    return {
        "cloud_models": cloud_models,
        "local_models": local_models,
        "ollama_online": ollama_online,
        "default": "openai/gpt-oss-20b",
        "default_provider": "groq",
    }


@app.post("/rag/images")
def images(request: ImageRequest) -> Dict[str, Any]:
    """Load diagrams separately so image verification never delays the answer."""
    if not embedding_model:
        raise HTTPException(
            status_code=503, detail="Embedding model is unavailable."
        )
    if not response_generator:
        raise HTTPException(
            status_code=503, detail="Response generator is unavailable."
        )
    if not image_handler:
        raise HTTPException(
            status_code=503, detail="Image handler is unavailable."
        )

    try:
        processed = query_processor.process_query(request.query, "beginner")
        query_embedding = embedding_model.encode(processed["query"])
        matches = response_generator.fetch_answer(
            query_embedding, top_k=5, subject=request.subject
        )
        result = image_handler.get_images(
            matches=matches,
            user_question=request.query,
            topic=request.topic or None,
            mode=request.mode,
            subject=request.subject,
        )
        return {"images": result}
    except Exception as error:
        raise HTTPException(
            status_code=500, detail=f"Failed to load images: {error}"
        ) from error


# ── Document Management Endpoints ──────────────────────────────────────
@app.post("/rag/index")
def index_documents(request: IndexRequest) -> Dict[str, Any]:
    if not document_processor:
        raise HTTPException(
            status_code=503, detail="Document processor is unavailable."
        )
    try:
        if request.filenames:
            for filename in request.filenames:
                candidate_paths = [
                    os.path.join(UPLOAD_DIR, request.subject.lower(), "documents", filename) if request.subject else None,
                    os.path.join(UPLOAD_DIR, request.subject.upper(), "documents", filename) if request.subject else None,
                    os.path.join(UPLOAD_DIR, request.subject.lower(), filename) if request.subject else None,
                    os.path.join(UPLOAD_DIR, request.subject.upper(), filename) if request.subject else None,
                    os.path.join(UPLOAD_DIR, filename),
                ]
                filepath = next((p for p in candidate_paths if p and os.path.exists(p)), None)
                if filepath and os.path.exists(filepath):
                    document_processor.process_single_pdf(
                        filepath, subject=request.subject
                    )
        else:
            document_processor.upload_to_vector_db()

        return {
            "message": "Documents indexed successfully.",
            "subject": request.subject,
            "prerequisite_topics": (
                len(response_generator.get_prerequisites_for_subject(request.subject))
                if response_generator
                else 0
            ),
        }
    except Exception as error:
        raise HTTPException(
            status_code=500, detail=f"Failed to index documents: {error}"
        ) from error


@app.post("/rag/index/stream")
def index_documents_stream(request: IndexRequest):
    if not document_processor:
        raise HTTPException(
            status_code=503, detail="Document processor is unavailable."
        )

    def event_stream():
        q = queue.Queue()

        def notify(pct, stage):
            q.put({"percent": pct, "stage": stage})

        def worker():
            try:
                if request.filenames:
                    total_files = len(request.filenames)
                    for f_idx, filename in enumerate(request.filenames):
                        candidate_paths = [
                            os.path.join(UPLOAD_DIR, request.subject.lower(), "documents", filename) if request.subject else None,
                            os.path.join(UPLOAD_DIR, request.subject.upper(), "documents", filename) if request.subject else None,
                            os.path.join(UPLOAD_DIR, request.subject.lower(), filename) if request.subject else None,
                            os.path.join(UPLOAD_DIR, request.subject.upper(), filename) if request.subject else None,
                            os.path.join(UPLOAD_DIR, filename),
                        ]
                        filepath = next((p for p in candidate_paths if p and os.path.exists(p)), None)
                        if filepath and os.path.exists(filepath):
                            file_base_pct = int((f_idx / total_files) * 100)
                            file_weight = 1.0 / total_files

                            def file_progress(pct, msg):
                                overall_pct = int(
                                    file_base_pct + (pct * file_weight)
                                )
                                stage_label = (
                                    msg
                                    if total_files == 1
                                    else f"[{filename}] {msg}"
                                )
                                notify(min(overall_pct, 98), stage_label)

                            document_processor.process_single_pdf(
                                filepath,
                                subject=request.subject,
                                progress_callback=file_progress,
                            )
                else:
                    notify(50, "Indexing all documents in vector database...")
                    document_processor.upload_to_vector_db()

                notify(100, "Documents indexed successfully.")
                q.put(None)
            except Exception as e:
                q.put({"error": str(e), "percent": -1})
                q.put(None)

        t = threading.Thread(target=worker, daemon=True)
        t.start()

        while True:
            item = q.get()
            if item is None:
                break
            yield f"data: {json.dumps(item)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/rag/delete")
def delete_document(request: DocumentRequest) -> Dict[str, Any]:
    if not document_processor:
        raise HTTPException(
            status_code=503, detail="Document processor is unavailable."
        )
    try:
        result = document_processor.delete_document(
            request.filename, subject=request.subject
        )
        return {
            "message": f"Document '{request.filename}' deleted successfully.",
            **result,
            "subject": request.subject,
            "prerequisite_topics": (
                len(response_generator.get_prerequisites_for_subject(request.subject))
                if response_generator
                else 0
            ),
        }
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(
            status_code=500, detail=f"Failed to delete document: {error}"
        ) from error


# ── Learner Modelling (BKT & Forgetting Decay) ─────────────────────────
@app.post("/learner/bkt-update", response_model=BKTUpdateResponse)
def learner_bkt_update(request: BKTUpdateRequest) -> BKTUpdateResponse:
    """Computes time decay, BKT sequence update, and memory stability adaptation."""
    # 1. Compute time-decayed effective prior if elapsed_days > 0
    decay_result = compute_effective_mastery(
        p_known=request.p_known,
        elapsed_days=request.elapsed_days,
        memory_stability=request.memory_stability,
    )
    effective_prior = decay_result["effective_mastery"]

    # 2. Run BKT update on observations starting from effective_prior
    bkt_result = update_bkt_sequence(
        p_known=effective_prior,
        observations=request.observations,
        p_learn=request.p_learn,
        p_guess=request.p_guess,
        p_slip=request.p_slip,
    )
    posterior = bkt_result["posterior_mastery"]

    # 3. Update memory stability and review streak based on observation accuracy
    if request.observations:
        accuracy = sum(1 for obs in request.observations if obs) / len(request.observations)
        new_stability, new_streak = update_stability(
            current_stability=request.memory_stability,
            review_streak=request.review_streak,
            accuracy=accuracy,
        )
    else:
        new_stability, new_streak = request.memory_stability, request.review_streak

    mastered = posterior >= MASTERY_THRESHOLD

    return BKTUpdateResponse(
        prior_mastery=round(request.p_known, 4),
        effective_prior=effective_prior,
        posterior_mastery=posterior,
        mastered=mastered,
        needs_refresher=decay_result["needs_refresher"] if not request.observations else False,
        effective_mastery=posterior if request.observations else effective_prior,
        memory_stability=new_stability,
        review_streak=new_streak,
    )


@app.post(
    "/learner/diagnose-misconception",
    response_model=MisconceptionDiagnosisResponse,
)
def learner_diagnose_misconception(
    request: MisconceptionDiagnosisRequest,
) -> MisconceptionDiagnosisResponse:
    """Diagnoses the specific conceptual misconception behind selecting an incorrect option."""
    diagnosis = diagnose_wrong_answer(
        topic=request.topic,
        question=request.question,
        selected_answer=request.selected_answer,
        correct_answer=request.correct_answer,
    )
    return MisconceptionDiagnosisResponse(misconception=diagnosis)


if __name__ == "__main__":
    import uvicorn

    # Support running both `python main.py` (inside tutor/) and `python tutor/main.py` (from root)
    app_target = "main:app" if Path.cwd().name == "tutor" else "tutor.main:app"
    uvicorn.run(app_target, host="127.0.0.1", port=8000, reload=True)



