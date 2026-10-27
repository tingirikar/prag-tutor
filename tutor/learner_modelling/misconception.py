"""Distractor Misconception Diagnosis Engine for PRAG-TUTOR.

Analyzes incorrect MCQ choices to pinpoint student conceptual misunderstandings.
"""

from tutor.config import get_groq_client
from tutor.query_processing.llm_provider import call_llm_response


def diagnose_wrong_answer(
    topic: str,
    question: str,
    selected_answer: str,
    correct_answer: str,
) -> str:
    """Diagnoses the conceptual misconception behind choosing a distractor.

    Args:
        topic: The lesson topic of the question.
        question: The question text.
        selected_answer: The incorrect option chosen by the learner.
        correct_answer: The correct answer.

    Returns:
        A concise sentence (max 25 words) diagnosing the misconception.
    """
    fallback = (
        f"Misunderstood '{question}' in {topic}: "
        f"selected '{selected_answer}' instead of '{correct_answer}'."
    )

    prompt = (
        f"Topic: {topic}\n"
        f"Question: {question}\n"
        f"Correct Answer: {correct_answer}\n"
        f"Student's Incorrect Selection: {selected_answer}\n\n"
        f"Identify the specific conceptual misconception or false assumption that caused "
        f"the student to select this incorrect answer instead of the correct one. "
        f"Respond in exactly ONE concise sentence (maximum 25 words). "
        f"Do not include introductory words like 'The student' or quotation marks."
    )

    messages = [
        {
            "role": "system",
            "content": (
                "You are an expert pedagogical diagnostician. Identify the conceptual misconception "
                "behind a student's choice of an MCQ distractor. State the flaw in understanding in "
                "exactly one concise sentence (maximum 25 words)."
            ),
        },
        {"role": "user", "content": prompt},
    ]

    try:
        groq_client = get_groq_client()
        content, _, _ = call_llm_response(
            groq_client=groq_client,
            messages=messages,
            default_model="qwen/qwen3.8-27b",
        )
        if content and content.strip():
            cleaned = content.strip().strip('"').strip("'")
            lines = [line.strip() for line in cleaned.split("\n") if line.strip()]
            first_line = lines[0] if lines else cleaned
            if len(first_line) > 200:
                first_line = first_line[:197] + "..."
            return first_line
    except Exception as error:
        print(f"[Warning] LLM misconception diagnosis error: {error}")

    return fallback
