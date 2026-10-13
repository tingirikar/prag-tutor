"""Orchestrates RAG retrieval, topic identification, prompt assembly, and response generation."""

import json
import random
import re
from typing import Any, Dict, List, Optional, Set

import requests
from groq import Groq

from tutor.config import (
    GROQ_API_KEY,
    OLLAMA_MODEL,
    OLLAMA_URL,
    UPLOAD_DIR,
    get_groq_client,
    get_pinecone_index,
)
from tutor.query_processing.llm_provider import (
    call_llm_response,
    generate_local_response,
)
from tutor.query_processing.prompt_builder import (
    build_dynamic_prompt as construct_prompt,
)
from tutor.query_processing.topic_identifier import (
    STOP_WORDS,
    get_all_prerequisites_data,
    get_documents_for_subject as fetch_docs,
    get_prerequisites_for_subject as fetch_subject_prereqs,
    get_prerequisites_for_topic as fetch_topic_prereqs,
    identify_topic_from_rag as match_topic,
    stem as stem_word,
)
from tutor.query_processing.vector_search import (
    active_document_names as list_active_docs,
    fetch_answer as retrieve_vectors,
    is_active_document as check_active_doc,
)
from tutor.schemas import ResponseResult


class ResponseGenerator:
    """Intelligent tutoring engine combining Pinecone RAG, prerequisite graphing, and multi-model LLM generation."""

    TUTOR_PROMPT_VERSION = "v2-grounded-tutor"

    def __init__(
        self,
        vector_db_api_key: Optional[str] = None,
        llm_api_key: Optional[str] = None,
        model_name: str = "openai/gpt-oss-20b",
        prerequisites_file: Optional[str] = None,
        documents_dir: Optional[str] = None,
    ):
        self.index = get_pinecone_index()
        self.groq_client = (
            Groq(api_key=llm_api_key) if llm_api_key else get_groq_client()
        )
        self.model_name = model_name
        self.documents_dir = documents_dir or UPLOAD_DIR
        self.ollama_url = OLLAMA_URL
        self.ollama_model = OLLAMA_MODEL

    @property
    def prerequisites_data(self) -> Dict[str, List[str]]:
        return get_all_prerequisites_data()

    def get_prerequisites_for_subject(
        self, subject: Optional[str] = None
    ) -> Dict[str, List[str]]:
        return fetch_subject_prereqs(subject)

    def get_documents_for_subject(self, subject: Optional[str] = None) -> Set[str]:
        return fetch_docs(subject)

    def stem(self, w: str) -> str:
        return stem_word(w)

    def identify_topic_from_rag(
        self,
        matches: List[Any],
        user_question: Optional[str] = None,
        subject: Optional[str] = None,
    ) -> Optional[str]:
        return match_topic(
            matches, user_question=user_question, subject=subject
        )

    def get_prerequisites_for_topic(
        self, topic: Optional[str], subject: Optional[str] = None
    ) -> List[str]:
        return fetch_topic_prereqs(topic, subject=subject)

    def fetch_answer(
        self, query_embedding: Any, top_k: int = 5, subject: Optional[str] = None
    ) -> List[Any]:
        return retrieve_vectors(
            index=self.index,
            query_embedding=query_embedding,
            top_k=top_k,
            subject=subject,
            documents_dir=self.documents_dir,
        )

    def _is_active_document(
        self, document_name: Optional[str], subject: Optional[str] = None
    ) -> bool:
        return check_active_doc(
            document_name, subject=subject, documents_dir=self.documents_dir
        )

    def _active_document_names(self, subject: Optional[str] = None) -> List[str]:
        return list_active_docs(subject=subject, documents_dir=self.documents_dir)

    def build_dynamic_prompt(
        self,
        context: str,
        level: str,
        prerequisites: Optional[List[str]] = None,
        user_question: Optional[str] = None,
        topic: Optional[str] = None,
        image_mode: str = "notes",
        subject: str = "",
    ) -> str:
        subj_label = (subject or "").strip().upper()
        active_docs = self._active_document_names(subject=subj_label)
        return construct_prompt(
            context=context,
            level=level,
            prerequisites=prerequisites,
            user_question=user_question,
            topic=topic,
            image_mode=image_mode,
            subject=subj_label,
            prompt_version=self.TUTOR_PROMPT_VERSION,
            active_documents=active_docs,
        )

    def _generate_local_response(
        self, messages: List[Dict[str, str]], model_name: Optional[str] = None
    ) -> Optional[str]:
        target_model = model_name or self.ollama_model
        return generate_local_response(
            messages, self.ollama_url, target_model
        )

    def generate_response(
        self,
        matches: List[Any],
        level: str,
        prerequisites: Optional[List[str]] = None,
        user_question: Optional[str] = None,
        topic: Optional[str] = None,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        preferred_model: Optional[str] = None,
        provider: Optional[str] = None,
        subject: str = "",
        image_mode: str = "notes",
    ) -> ResponseResult:
        # Lexically rerank retrieved matches against student query so the most relevant chunks lead the context
        q_text = (user_question or topic or "").lower()
        q_tokens = {
            stem_word(w)
            for w in re.findall(r"\b[a-zA-Z]{3,}\b", q_text)
            if stem_word(w) not in STOP_WORDS
        }

        def match_sort_key(m):
            meta = (
                m.get("metadata", {})
                if isinstance(m, dict)
                else getattr(m, "metadata", {})
            )
            s = (meta.get("sentence") or "").lower()
            doc = (meta.get("document") or "").lower()
            overlap = sum(1 for tok in q_tokens if tok in s or tok in doc)
            sim_score = float(
                m.get("score")
                if isinstance(m, dict)
                else getattr(m, "score", 0.0) or 0.0
            )
            return (overlap > 0, overlap, sim_score)

        sorted_matches = (
            sorted(matches, key=match_sort_key, reverse=True)
            if q_tokens
            else matches
        )

        sentences = []
        for match in sorted_matches:
            sentence = (
                match.get("metadata", {}).get("sentence", "")
                if isinstance(match, dict)
                else getattr(match, "metadata", {}).get("sentence", "")
            )
            sentence = sentence.strip()
            if len(sentence) < 8:
                continue
            if len(sentence) > 500:
                sentence = sentence[:500] + "..."
            sentences.append(sentence)
        context = " ".join(sentences)
        if len(context) > 2000:
            context = context[:2000] + "..."

        subj_label = (subject or "").strip().upper()

        prompt = self.build_dynamic_prompt(
            context=context,
            level=level,
            prerequisites=prerequisites,
            user_question=user_question,
            topic=topic,
            image_mode=image_mode,
            subject=subj_label,
        )

        system_instruction = (
            f"You are a helpful, knowledgeable, and encouraging intelligent tutor EXCLUSIVELY for {subj_label}.\n"
            f"STRICT SUBJECT ISOLATION RULES:\n"
            f"1. You only teach and discuss topics related to {subj_label}.\n"
            f"2. You must NEVER reference, acknowledge, or mention documents, files, or notes from other subjects (such as Data Structures and Algorithms or Machine Learning).\n"
            f"3. If asked about course materials or uploads, refer ONLY to the verified course uploads for {subj_label}.\n"
            f"4. If no course materials exist for {subj_label}, clearly state that no documents have been uploaded for {subj_label} yet, but offer to assist with fundamental concepts in {subj_label}."
        )
        messages = [{"role": "system", "content": system_instruction}]
        if conversation_history:
            for turn in conversation_history[-4:]:
                if (
                    isinstance(turn, dict)
                    and turn.get("role") in ["user", "assistant"]
                    and turn.get("content")
                ):
                    messages.append(
                        {"role": turn["role"], "content": turn["content"]}
                    )
        messages.append({"role": "user", "content": prompt})

        text_res, model_used, provider_used = call_llm_response(
            groq_client=self.groq_client,
            messages=messages,
            preferred_model=preferred_model,
            default_model=self.model_name,
            ollama_url=self.ollama_url,
            ollama_model=self.ollama_model,
            provider=provider,
        )

        if text_res:
            return ResponseResult(
                text_res,
                topic=topic,
                prerequisites=prerequisites or [],
                model=model_used,
                provider=provider_used,
            )

        prereq_note = (
            f"\nIdentified Prerequisites: {', '.join(prerequisites)}\n"
            if prerequisites
            else ""
        )
        return ResponseResult(
            "I could not complete the tutor response right now. "
            "Please try the question again in a moment."
            f"{prereq_note}",
            topic=topic,
            prerequisites=prerequisites or [],
            model=model_used,
            provider=provider_used,
        )

    def respond_to_user(
        self,
        query_embedding: Any,
        level: str,
        user_question: Optional[str] = None,
        topic: Optional[str] = None,
        prerequisites: Optional[List[str]] = None,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        preferred_model: Optional[str] = None,
        provider: Optional[str] = None,
        subject: str = "",
        image_mode: str = "notes",
    ) -> ResponseResult:
        # Step 1: Pinecone vector search isolated strictly to this subject namespace (filtered by min similarity threshold)
        matches = self.fetch_answer(
            query_embedding, top_k=5, subject=subject
        )

        has_verified_context = bool(matches and len(matches) > 0)

        # Step 2: Topic identification
        if not topic:
            topic = self.identify_topic_from_rag(
                matches, user_question, subject=subject
            )

        # Step 3: Retrieve prerequisites strictly for verified course topics
        # If the question is unrelated to the PDFs (no verified matches), do NOT assign any prerequisites
        if prerequisites is None:
            if has_verified_context and topic:
                prerequisites = self.get_prerequisites_for_topic(
                    topic, subject=subject
                )
            else:
                prerequisites = []

        # Step 4: Extract structured source citations
        sources = []
        for m in matches:
            meta = (
                m.get("metadata", {})
                if isinstance(m, dict)
                else getattr(m, "metadata", {})
            )
            doc_id = (
                m.get("id", "")
                if isinstance(m, dict)
                else getattr(m, "id", "")
            )
            doc_name = meta.get("document") or (
                doc_id.rsplit("_", 1)[0] if "_" in doc_id else "Course Document"
            )
            sentence = meta.get("sentence", "")
            score = (
                m.get("score")
                if isinstance(m, dict)
                else getattr(m, "score", None)
            )
            if sentence and len(sentence.strip()) > 8:
                sources.append(
                    {
                        "document": doc_name,
                        "snippet": sentence[:250]
                        + ("..." if len(sentence) > 250 else ""),
                        "score": round(float(score) * 100, 1)
                        if score
                        else None,
                    }
                )

        # Step 5: Generate grounded response
        result = self.generate_response(
            matches=matches,
            level=level,
            prerequisites=prerequisites,
            user_question=user_question,
            topic=topic,
            conversation_history=conversation_history,
            preferred_model=preferred_model,
            provider=provider,
            subject=subject,
            image_mode=image_mode,
        )

        return ResponseResult(
            response=str(result),
            topic=topic,
            prerequisites=prerequisites or [],
            sources=sources,
            model=getattr(result, "model", preferred_model or self.model_name),
            provider=getattr(result, "provider", provider or "groq"),
        )

    def generate_sample_questions(
        self, seed: Optional[str] = None, subject: Optional[str] = None
    ) -> List[Dict[str, str]]:
        subj_key = (subject or "").strip().upper()
        if not subj_key:
            return []
        subj_topics_map = self.get_prerequisites_for_subject(subj_key)
        all_topics = list(subj_topics_map.keys())

        if not all_topics:
            return []

        rng = random.Random(seed) if seed else random.Random()
        sample_size = min(12, len(all_topics))
        selected = rng.sample(all_topics, sample_size)
        topics = ", ".join(selected)

        course_label = f"{subj_key} course" if subj_key else "course"
        prompt = (
            f"Create exactly six fresh, diverse study questions for a {course_label} educational tutor dashboard. "
            f"Select from these available {course_label} topics where relevant: {topics}. "
            f"Seed: {seed or 'first-load'}. Vary the difficulty levels across beginner, intermediate, and expert. "
            "Return ONLY a valid JSON array of 6 objects. Each object must have exactly these keys: "
            '{"topic": "<topic name>", "question": "<question text>", "level": "<beginner|intermediate|expert>"}.'
        )
        messages = [
            {
                "role": "system",
                "content": "You create concise, useful study questions. Return ONLY valid JSON, no markdown fences.",
            },
            {"role": "user", "content": prompt},
        ]

        # 1. Groq cloud
        if self.groq_client:
            try:
                result = self.groq_client.chat.completions.create(
                    model=self.model_name,
                    messages=messages,
                    max_tokens=1200,
                )
                choice = result.choices[0]
                content = choice.message.content or ""
                parsed = self._parse_sample_questions(content)
                if parsed:
                    print("Sample questions generated via Groq.")
                    return parsed
            except Exception as error:
                print(f"Notice generating sample questions via Groq: {error}")

        # 2. Local Ollama
        try:
            response = requests.post(
                f"{self.ollama_url}/api/chat",
                json={
                    "model": self.ollama_model,
                    "messages": messages,
                    "stream": False,
                },
                timeout=(5, 60),
            )
            response.raise_for_status()
            content = response.json().get("message", {}).get("content", "")
            parsed = self._parse_sample_questions(content)
            if parsed:
                print(
                    f"Sample questions generated via local Ollama ({self.ollama_model})."
                )
                return parsed
        except Exception as error:
            print(f"Notice generating sample questions via Ollama: {error}")

        print(
            "Warning: Both Groq and Ollama failed for sample questions. Returning empty list."
        )
        return []

    def _parse_sample_questions(
        self, raw: str
    ) -> Optional[List[Dict[str, str]]]:
        if not raw or not raw.strip():
            return None
        text = raw.strip()

        fence_match = re.search(
            r"```(?:json)?\s*\n?(\[.*?\])\s*```", text, re.DOTALL
        )
        if fence_match:
            text = fence_match.group(1)
        else:
            bracket_match = re.search(
                r"(\[\s*[\{\[].*?[\}\]]\s*\])", text, re.DOTALL
            )
            if bracket_match:
                text = bracket_match.group(1)

        try:
            questions = json.loads(text)
        except (json.JSONDecodeError, ValueError):
            return None
        if not isinstance(questions, list) or len(questions) < 1:
            return None

        cleaned = []
        for item in questions:
            if isinstance(item, dict):
                if all(item.get(key) for key in ["topic", "question", "level"]):
                    cleaned.append(
                        {
                            "topic": str(item["topic"]).strip(),
                            "question": str(item["question"]).strip(),
                            "level": str(item["level"]).strip().lower(),
                        }
                    )
            elif isinstance(item, (list, tuple)) and len(item) >= 3:
                cleaned.append(
                    {
                        "topic": str(item[0]).strip(),
                        "question": str(item[1]).strip(),
                        "level": str(item[2]).strip().lower(),
                    }
                )
        return cleaned if len(cleaned) >= 1 else None
