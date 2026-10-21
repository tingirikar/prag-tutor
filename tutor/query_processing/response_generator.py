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

def normalize_topic_for_comparison(text: str) -> str:
    """Normalizes topic text to allow robust comparison across variations."""
    if not text:
        return ""
    cleaned = text.lower()
    cleaned = re.sub(r"\b(in\s+c\+\+|in\s+python|in\s+java|for\s+dsa)\b", "", cleaned)
    cleaned = re.sub(r"[^\w\s]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = re.sub(r"s\b", "", cleaned)
    return cleaned


def is_prerequisite_mastered(prereq: str, mastered_topics: List[str]) -> bool:
    """Checks whether a prerequisite topic has already been mastered by the student."""
    if not prereq or not mastered_topics:
        return False
    norm_prereq = normalize_topic_for_comparison(prereq)
    if not norm_prereq:
        return False

    for mastered in mastered_topics:
        norm_mastered = normalize_topic_for_comparison(mastered)
        if not norm_mastered:
            continue
        if norm_prereq == norm_mastered:
            return True
        if norm_prereq in norm_mastered or norm_mastered in norm_prereq:
            return True
        prereq_words = set(norm_prereq.split())
        mastered_words = set(norm_mastered.split())
        if prereq_words and prereq_words.issubset(mastered_words):
            return True
        if mastered_words and mastered_words.issubset(prereq_words):
            return True

    return False


def extract_profile_field(item: Any, key: str, default: Any = None) -> Any:
    """Safely extracts a field from a dict or Pydantic model."""
    if isinstance(item, dict):
        return item.get(key, default)
    return getattr(item, key, default)


def find_profile_match(
    topic_name: str, learner_profile: Optional[List[Any]]
) -> Optional[Any]:
    """Matches a topic against learner_profile using case-insensitive normalized matching."""
    if not topic_name or not learner_profile:
        return None
    norm_target = normalize_topic_for_comparison(topic_name)
    if not norm_target:
        return None

    # 1. Exact match on normalized_topic or topic
    for item in learner_profile:
        item_norm = extract_profile_field(item, "normalized_topic")
        item_topic = extract_profile_field(item, "topic") or ""
        if item_norm and norm_target == normalize_topic_for_comparison(item_norm):
            return item
        if item_topic and norm_target == normalize_topic_for_comparison(item_topic):
            return item

    # 2. Substring or token-subset match
    target_words = set(norm_target.split())
    for item in learner_profile:
        item_topic = extract_profile_field(item, "topic") or ""
        item_norm = extract_profile_field(item, "normalized_topic") or normalize_topic_for_comparison(item_topic)
        if norm_target in item_norm or item_norm in norm_target:
            return item
        item_words = set(item_norm.split())
        if target_words and item_words and (target_words.issubset(item_words) or item_words.issubset(target_words)):
            return item

    return None


def extract_learner_signals(
    current_topic: Optional[str],
    prerequisites: Optional[List[str]],
    learner_profile: Optional[List[Any]],
    mastered_topics: Optional[List[str]] = None,
    prerequisite_weights: Optional[Dict[str, float]] = None,
) -> Dict[str, Any]:
    """Matches query topic and its prerequisites against learner_profile (or falls back to mastered_topics).

    Extracts three structured signals:
    - topic_mastery_summary: list of {topic, effective_mastery, mastered, needs_refresher}
    - refresher_topics: topics where needs_refresher == True (prioritized by DAG criticality weight)
    - relevant_misconceptions: unresolved active misconceptions
    """
    topic_mastery_summary: List[Dict[str, Any]] = []
    refresher_topics: List[str] = []
    relevant_misconceptions: List[str] = []
    seen_misc: Set[str] = set()

    candidate_topics: List[str] = []
    if current_topic and current_topic.strip():
        candidate_topics.append(current_topic.strip())
    if prerequisites:
        for p in prerequisites:
            clean_p = (p or "").strip()
            if clean_p and clean_p not in candidate_topics:
                candidate_topics.append(clean_p)

    has_profile = bool(learner_profile and len(learner_profile) > 0)
    has_mastered = bool(mastered_topics and len(mastered_topics) > 0)

    if not has_profile and not has_mastered:
        return {
            "topic_mastery_summary": [],
            "refresher_topics": [],
            "relevant_misconceptions": [],
        }

    for cand in candidate_topics:
        matched_item = find_profile_match(cand, learner_profile) if has_profile else None
        if matched_item:
            p_known = float(extract_profile_field(matched_item, "p_known", 0.20))
            eff_mastery = float(extract_profile_field(matched_item, "effective_mastery", p_known))
            is_mastered = bool(extract_profile_field(matched_item, "mastered", False))
            needs_refresher = bool(extract_profile_field(matched_item, "needs_refresher", False))
            active_misc = extract_profile_field(matched_item, "active_misconceptions", []) or []

            topic_mastery_summary.append({
                "topic": cand,
                "effective_mastery": eff_mastery,
                "mastered": is_mastered,
                "needs_refresher": needs_refresher,
            })
            if needs_refresher and cand not in refresher_topics:
                refresher_topics.append(cand)
            for m in active_misc:
                m_str = str(m).strip()
                if m_str and m_str not in seen_misc:
                    seen_misc.add(m_str)
                    relevant_misconceptions.append(m_str)
        elif has_mastered:
            is_mastered = is_prerequisite_mastered(cand, mastered_topics or [])
            eff_mastery = 0.85 if is_mastered else 0.20
            topic_mastery_summary.append({
                "topic": cand,
                "effective_mastery": eff_mastery,
                "mastered": is_mastered,
                "needs_refresher": False,
            })

    # Also check if any candidate topic has a decayed profile item in learner_profile
    if has_profile and learner_profile:
        for item in learner_profile:
            needs_ref = bool(extract_profile_field(item, "needs_refresher", False))
            t_name = extract_profile_field(item, "topic", "")
            if needs_ref and t_name and t_name not in refresher_topics:
                for cand in candidate_topics:
                    if normalize_topic_for_comparison(cand) == normalize_topic_for_comparison(t_name):
                        if cand not in refresher_topics:
                            refresher_topics.append(cand)

    # Misconceptions fallback: if no misconceptions were matched for specific topic or prereqs,
    # collect active misconceptions from the subject profile
    if not relevant_misconceptions and has_profile and learner_profile:
        for item in learner_profile:
            active_misc = extract_profile_field(item, "active_misconceptions", []) or []
            for m in active_misc:
                m_str = str(m).strip()
                if m_str and m_str not in seen_misc:
                    seen_misc.add(m_str)
                    relevant_misconceptions.append(m_str)
            if len(relevant_misconceptions) >= 5:
                break

    # Prioritize refresher topics with higher prerequisite criticality weights
    if prerequisite_weights and refresher_topics:
        refresher_topics.sort(
            key=lambda t: -float(prerequisite_weights.get(t, 0.50))
        )

    return {
        "topic_mastery_summary": topic_mastery_summary,
        "refresher_topics": refresher_topics,
        "relevant_misconceptions": relevant_misconceptions,
    }



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

    def get_prerequisite_details_for_topic(
        self, topic: Optional[str], subject: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        from tutor.query_processing.topic_identifier import (
            get_prerequisite_details_for_topic as fetch_topic_prereq_details,
        )
        return fetch_topic_prereq_details(topic, subject=subject)


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
        topic_mastery_summary: Optional[List[Dict[str, Any]]] = None,
        refresher_topics: Optional[List[str]] = None,
        relevant_misconceptions: Optional[List[str]] = None,
        learner_profile: Optional[List[Any]] = None,
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
            topic_mastery_summary=topic_mastery_summary,
            refresher_topics=refresher_topics,
            relevant_misconceptions=relevant_misconceptions,
            learner_profile=learner_profile,
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
        mastered_topics: Optional[List[str]] = None,
        learner_profile: Optional[List[Any]] = None,
        topic_mastery_summary: Optional[List[Dict[str, Any]]] = None,
        refresher_topics: Optional[List[str]] = None,
        relevant_misconceptions: Optional[List[str]] = None,
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
            topic_mastery_summary=topic_mastery_summary,
            refresher_topics=refresher_topics,
            relevant_misconceptions=relevant_misconceptions,
            learner_profile=learner_profile,
        )

        system_instruction = (
            f"You are a helpful, knowledgeable, and encouraging intelligent tutor EXCLUSIVELY for {subj_label} teaching at the {level.upper()} level.\n"
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
        mastered_topics: Optional[List[str]] = None,
        learner_profile: Optional[List[Any]] = None,
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
        prereq_weights: Dict[str, float] = {}
        if prerequisites is None:
            if has_verified_context and topic:
                prerequisites = self.get_prerequisites_for_topic(
                    topic, subject=subject
                )
                details = self.get_prerequisite_details_for_topic(
                    topic, subject=subject
                )
                for d in details:
                    d_top = d.get("topic") or d.get("prerequisite")
                    if d_top and "weight" in d:
                        try:
                            prereq_weights[d_top] = float(d["weight"])
                        except (ValueError, TypeError):
                            pass
            else:
                prerequisites = []

        if prerequisites:
            for idx, p in enumerate(prerequisites):
                if p not in prereq_weights:
                    prereq_weights[p] = max(0.50, round(1.0 - 0.05 * idx, 2))

        # Keep initial prerequisites before filtering for learner cognitive state modeling
        initial_prerequisites = list(prerequisites) if prerequisites else []

        # Step 3b: Learner Model filtering
        # Filter out any prerequisites that the student has already mastered,
        # unless memory decay has set in and the student needs a refresher!
        if prerequisites and (mastered_topics or learner_profile):
            unmastered_prereqs = []
            for p in prerequisites:
                matched_item = (
                    find_profile_match(p, learner_profile)
                    if learner_profile
                    else None
                )
                if matched_item:
                    is_m = bool(extract_profile_field(matched_item, "mastered", False))
                    needs_ref = bool(extract_profile_field(matched_item, "needs_refresher", False))
                    if is_m and not needs_ref:
                        print(
                            f"[LEARNER MODEL] Prerequisite '{p}' is mastered and retained. Skipping prerequisite intro."
                        )
                        continue
                    elif needs_ref:
                        print(
                            f"[LEARNER MODEL] Prerequisite '{p}' was mastered but decayed (needs refresher). Prioritizing."
                        )
                elif mastered_topics and is_prerequisite_mastered(p, mastered_topics):
                    print(
                        f"[LEARNER MODEL] Prerequisite '{p}' is already mastered by student (legacy). Skipping."
                    )
                    continue

                unmastered_prereqs.append(p)

            # Preserve DAG criticality order and prioritize unmastered or decayed prerequisites with highest criticality weight first
            unmastered_prereqs.sort(
                key=lambda p: -prereq_weights.get(p, 0.50)
            )
            prerequisites = unmastered_prereqs

        # Extract structured learner signals for continuous BKT, memory decay, and misconceptions
        learner_signals = extract_learner_signals(
            current_topic=topic,
            prerequisites=initial_prerequisites,
            learner_profile=learner_profile,
            mastered_topics=mastered_topics,
            prerequisite_weights=prereq_weights,
        )


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
            mastered_topics=mastered_topics,
            learner_profile=learner_profile,
            topic_mastery_summary=learner_signals["topic_mastery_summary"],
            refresher_topics=learner_signals["refresher_topics"],
            relevant_misconceptions=learner_signals["relevant_misconceptions"],
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

        # 1. Groq cloud with multi-model fallback
        if self.groq_client:
            groq_models = ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"]
            for gm in groq_models:
                try:
                    result = self.groq_client.chat.completions.create(
                        model=gm,
                        messages=messages,
                        max_tokens=1200,
                    )
                    choice = result.choices[0]
                    content = choice.message.content or ""
                    if not content and getattr(choice.message, "reasoning", None):
                        content = choice.message.reasoning or ""
                    parsed = self._parse_sample_questions(content)
                    if parsed:
                        print(f"Sample questions generated via Groq ({gm}).")
                        return parsed
                except Exception as error:
                    print(f"Notice generating sample questions via Groq ({gm}): {error}")

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

        # 3. Deterministic syllabus fallback from course topics
        fallback_questions = []
        levels = ["beginner", "intermediate", "expert"]
        for idx, top in enumerate(selected[:6]):
            lvl = levels[idx % len(levels)]
            fallback_questions.append({
                "topic": top,
                "question": f"Explain the core concepts, operations, and implementation of {top}.",
                "level": lvl,
            })
        if fallback_questions:
            print(f"Using {len(fallback_questions)} syllabus sample questions from course topics.")
            return fallback_questions

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
