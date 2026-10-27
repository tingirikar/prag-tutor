"""Prerequisite generation pipeline: PDF reading, topic extraction, DAG inference, validation, and storage."""

import logging
import os
import re
from typing import Any, Callable, Dict, List, Optional, Union

from groq import Groq

from tutor.config import GROQ_API_KEY, get_db, get_groq_client
from tutor.document_processing.pdf_reader import read_pdf_by_page
from tutor.prerequisite_processing.graph_builder import (
    generate_prerequisite_graph as build_graph,
    generate_prerequisite_graph_weighted as build_graph_weighted,
)
from tutor.prerequisite_processing.storage import (
    save_prerequisites_to_mongodb as store_prereqs,
)
from tutor.prerequisite_processing.text_cleaning import (
    clean_extracted_text,
    get_safe_filename,
    split_text_into_representative_windows,
)
from tutor.prerequisite_processing.topic_extraction import (
    deduplicate_and_filter_topics as dedup_topics,
    deduplicate_and_filter_topics_with_metadata as dedup_topics_meta,
    extract_candidate_topics_from_chunk as extract_topics,
    extract_topics_with_metadata as extract_topics_meta,
    normalize_topic_name as norm_topic,
    parse_json_safely,
)
from tutor.prerequisite_processing.validation import (
    break_cycles,
    remove_transitive_redundancies,
    validate_and_sanitize_graph as validate_graph,
    validate_and_sanitize_graph_with_details as validate_graph_with_details,
)

logger = logging.getLogger(__name__)


class PrerequisiteGenerator:
    """Automated educational prerequisite extraction and graph generation engine.

    Extracts candidate learning topics, filters micro-topics, determines educational
    prerequisites via LLM with pedagogical necessity and criticality weights, enforces 0-4 prereq limits,
    and sanitizes against cycles and redundancies.
    """

    def __init__(
        self,
        llm_api_key: Optional[str] = None,
        model_name: str = "qwen/qwen3.8-27b",
        fallback_models: Optional[List[str]] = None,
    ):
        if not llm_api_key:
            llm_api_key = GROQ_API_KEY

        self.llm_api_key = llm_api_key
        self.groq_client = (
            Groq(api_key=llm_api_key) if llm_api_key else get_groq_client()
        )
        self.model_name = model_name
        self.fallback_models = fallback_models or [
            "openai/gpt-oss-20b",
            "llama-3.3-70b-versatile",
            "groq/compound-mini",
        ]

    def _call_llm(
        self,
        prompt: str,
        system_prompt: str = "You are an educational curriculum analysis system.",
        temperature: float = 0.1,
    ) -> str:
        """Invokes Groq LLM with fallback support and thinking block stripping."""
        client = self.groq_client or get_groq_client()
        if not client:
            raise ValueError(
                "Groq client is not initialized. Please provide a valid GROQ_API_KEY."
            )

        candidate_models = [self.model_name]
        for fb in self.fallback_models:
            if fb not in candidate_models:
                candidate_models.append(fb)

        last_error = None
        for model in candidate_models:
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=temperature,
                    max_tokens=4096,
                )
                raw_content = response.choices[0].message.content or ""
                # Strip think blocks
                cleaned = re.sub(
                    r"<think>.*?</think>", "", raw_content, flags=re.DOTALL
                )
                cleaned = re.sub(r"<think>.*", "", cleaned, flags=re.DOTALL)
                return cleaned.strip()
            except Exception as e:
                last_error = e
                continue

        raise RuntimeError(f"All Groq models failed. Last error: {last_error}")

    def _parse_json_safely(self, text: str) -> Any:
        return parse_json_safely(text)

    def extract_text_from_pdf(self, pdf_path: str) -> List[Dict[str, Any]]:
        """Extracts and cleans text page-by-page from a PDF."""
        raw_pages = read_pdf_by_page(pdf_path)
        pages = []
        for page_num, raw_text in raw_pages:
            cleaned = clean_extracted_text(raw_text)
            if cleaned.strip():
                pages.append({"page": page_num + 1, "text": cleaned})
        return pages

    def chunk_pages(
        self,
        pages: List[Dict[str, Any]],
        max_words_per_chunk: int = 6000,
        max_pages_per_chunk: int = 25,
    ) -> List[str]:
        """Groups pages into cohesive chunks for candidate topic extraction."""
        if not pages:
            return []

        total_words = sum(len(p["text"].split()) for p in pages)
        if len(pages) <= 8 and total_words <= 4000:
            return ["\n\n".join(p["text"] for p in pages)]

        chunks = []
        curr_chunk_texts = []
        curr_words = 0
        curr_pages = 0

        for page in pages:
            page_text = page["text"]
            words = len(page_text.split())

            if (
                curr_words + words > max_words_per_chunk
                or curr_pages >= max_pages_per_chunk
            ) and curr_chunk_texts:
                chunks.append("\n\n".join(curr_chunk_texts))
                curr_chunk_texts = [page_text]
                curr_words = words
                curr_pages = 1
            else:
                curr_chunk_texts.append(page_text)
                curr_words += words
                curr_pages += 1

        if curr_chunk_texts:
            chunks.append("\n\n".join(curr_chunk_texts))

        return chunks

    def extract_candidate_topics_from_chunk(self, chunk_text: str) -> List[str]:
        return extract_topics(chunk_text, self._call_llm)

    def extract_topics_with_metadata(self, text: str) -> List[Dict[str, Any]]:
        return extract_topics_meta(text, self._call_llm)

    def normalize_topic_name(self, topic: str) -> str:
        return norm_topic(topic)

    def deduplicate_and_filter_topics(
        self, raw_topics: List[str], max_topics: int = 35
    ) -> List[str]:
        return dedup_topics(raw_topics, max_topics=max_topics)

    def deduplicate_and_filter_topics_with_metadata(
        self, raw_topics: List[Dict[str, Any]], max_topics: int = 35
    ) -> List[Dict[str, Any]]:
        return dedup_topics_meta(raw_topics, max_topics=max_topics)

    def generate_prerequisite_graph(
        self,
        topics: Union[List[str], List[Dict[str, Any]]],
        doc_summary: str = "",
        return_details: bool = False,
    ) -> Union[Dict[str, List[str]], Dict[str, List[Dict[str, Any]]]]:
        return build_graph(
            topics,
            doc_summary=doc_summary,
            call_llm_fn=self._call_llm,
            return_details=return_details,
        )

    def generate_prerequisite_graph_weighted(
        self,
        topics: Union[List[str], List[Dict[str, Any]]],
        doc_summary: str = "",
    ) -> Dict[str, List[Dict[str, Any]]]:
        return build_graph_weighted(
            topics, doc_summary=doc_summary, call_llm_fn=self._call_llm
        )

    def validate_and_sanitize_graph(
        self,
        raw_graph: Dict[str, Any],
        known_topics: Union[List[str], List[Dict[str, Any]]],
        first_seen_order: Optional[Dict[str, int]] = None,
        return_details: bool = False,
    ) -> Union[Dict[str, List[str]], Dict[str, List[Dict[str, Any]]]]:
        return validate_graph(
            raw_graph,
            known_topics,
            first_seen_order=first_seen_order,
            return_details=return_details,
        )

    def _break_cycles(
        self,
        graph: Dict[str, Any],
        first_seen_order: Optional[Dict[str, int]] = None,
    ) -> Dict[str, Any]:
        return break_cycles(graph, first_seen_order=first_seen_order)

    def _remove_transitive_redundancies(
        self, graph: Dict[str, Any]
    ) -> Dict[str, Any]:
        return remove_transitive_redundancies(graph)

    def save_prerequisites_to_mongodb(
        self,
        document_name: str,
        prerequisite_graph: Union[Dict[str, List[str]], Dict[str, List[Dict[str, Any]]]],
        subject: Optional[str] = None,
        first_seen_order: Optional[Dict[str, int]] = None,
        prerequisite_details: Optional[Dict[str, List[Dict[str, Any]]]] = None,
    ) -> int:
        return store_prereqs(
            document_name,
            prerequisite_graph,
            subject=subject,
            db=get_db(),
            first_seen_order=first_seen_order,
            prerequisite_details=prerequisite_details,
        )

    def generate_for_document(
        self,
        pdf_path: str,
        subject: Optional[str] = None,
        progress_callback: Optional[Callable[[int, str], None]] = None,
    ) -> Dict[str, Any]:
        """Executes the entire automated prerequisite generation pipeline:

        PDF -> Representative Window Extraction -> Topic Identification with Position & Context ->
        Lexical + Semantic Deduplication -> Pedagogical Necessity Prerequisite Generation with Weights ->
        Order- and Weight-Aware DAG Enforcement -> Cross-PDF Synonym Merging -> MongoDB Atlas Persistence.
        """

        def notify(pct, msg):
            if progress_callback:
                try:
                    progress_callback(pct, msg)
                except Exception:
                    pass

        if not os.path.exists(pdf_path):
            raise FileNotFoundError(f"PDF file not found: {pdf_path}")

        doc_basename = os.path.basename(pdf_path)

        # 1. Extract text from PDF
        notify(5, "Extracting document pages for curriculum analysis...")
        pages = self.extract_text_from_pdf(pdf_path)
        if not pages:
            return {
                "status": "error",
                "message": f"No extractable text found in '{doc_basename}'.",
                "topics_count": 0,
            }

        # 2. Windowed/structured full-document text processing
        full_doc_text = "\n\n".join(p["text"] for p in pages)
        windows = split_text_into_representative_windows(full_doc_text, max_windows=4, window_chars=7000)

        # 3. Extract candidate topics with metadata (first_seen_order and context_hint)
        total_windows = len(windows)
        candidate_meta: List[Dict[str, Any]] = []

        for w_idx, win in enumerate(windows):
            chunk_pct = 15 + int(35 * ((w_idx + 1) / max(total_windows, 1)))
            notify(
                chunk_pct, f"Analyzing concepts across document (section {w_idx+1}/{total_windows})..."
            )
            extracted = self.extract_topics_with_metadata(win)
            for item in extracted:
                # Offset position according to window
                item["first_seen_order"] = w_idx * 100000 + int(item.get("first_seen_order", 0))
                candidate_meta.append(item)

        # 4. Lexical and Semantic Deduplication
        notify(55, "Normalizing, deduplicating, and filtering learning topics...")
        normalized_topics_meta = self.deduplicate_and_filter_topics_with_metadata(candidate_meta)
        if not normalized_topics_meta:
            return {
                "status": "error",
                "message": f"No valid learning topics could be extracted from '{doc_basename}'.",
                "topics_count": 0,
            }

        # 5. Generate prerequisite relationships with pedagogical necessity & weights
        notify(
            70,
            f"Inferring prerequisites for {len(normalized_topics_meta)} core topics with AI...",
        )
        doc_summary = f"{doc_basename} ({len(pages)} pages)"
        raw_graph_weighted = self.generate_prerequisite_graph_weighted(
            normalized_topics_meta, doc_summary=doc_summary
        )

        # 6. Validate, break cycles via weakest edge score, and remove transitive redundancies
        notify(88, "Validating graph & resolving cyclic dependencies...")
        order_map = {t["topic"]: t["first_seen_order"] for t in normalized_topics_meta}
        sanitized_simple, sanitized_detailed = validate_graph_with_details(
            raw_graph_weighted,
            normalized_topics_meta,
            first_seen_order=order_map,
        )

        # 7. Save directly to MongoDB Atlas with cross-PDF merging
        notify(
            96, "Persisting syllabus prerequisites directly into MongoDB Atlas..."
        )
        saved_count = self.save_prerequisites_to_mongodb(
            doc_basename,
            sanitized_simple,
            subject=subject,
            first_seen_order=order_map,
            prerequisite_details=sanitized_detailed,
        )

        notify(100, f"Saved {saved_count} prerequisite topics into MongoDB Atlas.")
        return {
            "status": "success",
            "document": doc_basename,
            "topics_count": len(sanitized_simple),
            "subject": str(subject).strip().upper() if subject else "",
            "prerequisites": sanitized_simple,
            "prerequisite_details": sanitized_detailed,
        }
