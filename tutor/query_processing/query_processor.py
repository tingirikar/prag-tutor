"""Query pre-processing, whitespace normalization, and multi-turn conversational reformulation."""

import re
from typing import Any, Dict, List, Optional

from tutor.config import get_groq_client


class QueryProcessor:
    """Prepares user queries for semantic embedding and multi-turn conversational retrieval.

    Handles natural language normalization as well as conversational query condensation
    so follow-up questions ('What is an example of that?') are reformulated into standalone
    search queries before Pinecone vector retrieval.
    """

    def __init__(self):
        self.groq_client = None

    def process_query(self, query: str, level: str = "beginner") -> Dict[str, Any]:
        clean_query = " ".join(query.strip().split()) if query else ""
        return {"query": clean_query, "level": level}

    def condense_query(
        self,
        query: str,
        history: Optional[List[Dict[str, str]]] = None,
        subject: str = "",
        groq_client: Any = None,
    ) -> str:
        """Reformulates a conversational follow-up query into a standalone semantic search query."""
        clean_query = " ".join(query.strip().split()) if query else ""
        if not history or len(history) == 0 or not clean_query:
            return clean_query

        # Check if question contains pronouns or is short (< 12 words)
        pronoun_pattern = re.compile(
            r"\b(it|its|this|that|these|those|they|them|their|such|same|above|previous|example|why|how|what|explain|more)\b",
            re.IGNORECASE,
        )
        has_pronoun = bool(pronoun_pattern.search(clean_query))
        word_count = len(clean_query.split())

        if word_count > 12 and not has_pronoun:
            return clean_query

        client = groq_client or self.groq_client or get_groq_client()
        if not client:
            return clean_query

        # Format recent history turns
        history_snippets = []
        for turn in history[-4:]:
            role = turn.get("role", "")
            content = (turn.get("content") or "").strip()
            if content:
                snippet = content[:180] + ("..." if len(content) > 180 else "")
                history_snippets.append(f"{role.capitalize()}: {snippet}")

        if not history_snippets:
            return clean_query

        conversation_str = "\n".join(history_snippets)
        subj_str = f" in {subject.strip().upper()}" if subject else ""

        prompt = (
            f"You are a search query rewriting assistant for an educational course{subj_str}.\n"
            f"Given the conversation history and a follow-up user question, reformulate the follow-up question into a single standalone search query that preserves the context and specific subject concepts.\n"
            f"CRITICAL: Output ONLY the rewritten search query. Do not add quotes, preamble, or conversational filler.\n\n"
            f"Recent Conversation:\n{conversation_str}\n\n"
            f"Follow-up Question: {clean_query}\n"
            f"Standalone Search Query:"
        )

        try:
            response = client.chat.completions.create(
                model="openai/gpt-oss-20b",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=60,
                timeout=3.0,
            )
            condensed = (
                (response.choices[0].message.content or "")
                .strip()
                .strip('"')
                .strip("'")
            )
            # Filter think tags if present
            condensed = re.sub(r"<think>.*?</think>", "", condensed, flags=re.DOTALL).strip()
            condensed = re.sub(r"<think>.*", "", condensed, flags=re.DOTALL).strip()
            if condensed and len(condensed) >= 3 and len(condensed) < 300:
                print(
                    f"[QueryProcessor] Rewrote multi-turn query: '{clean_query}' -> '{condensed}'"
                )
                return condensed
        except Exception as e:
            print(f"[QueryProcessor] Notice during query condensation: {e}")

        return clean_query
