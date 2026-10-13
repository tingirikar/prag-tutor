"""LLM provider integration: Groq cloud client with model fallbacks and local Ollama execution."""

import re
from typing import Dict, List, Optional, Tuple

import requests


def generate_local_response(
    messages: List[Dict[str, str]],
    ollama_url: str,
    model_name: str,
) -> Optional[str]:
    """Generates a response using a local Ollama instance."""
    try:
        response = requests.post(
            f"{ollama_url}/api/chat",
            json={
                "model": model_name,
                "messages": messages,
                "stream": False,
                "options": {"num_predict": 2500},
            },
            timeout=(5, 120),
        )
        if response.status_code == 404:
            return (
                f"Local Ollama model '{model_name}' is not installed.\n\n"
                f"To install and run it locally, run this in your terminal:\n"
                f"```powershell\nollama pull {model_name}\n```"
            )
        response.raise_for_status()
        content = response.json().get("message", {}).get("content", "").strip()
        if content:
            print(f"Used local Ollama model '{model_name}'.")
            return content
    except requests.RequestException as error:
        print(f"Notice local Ollama unavailable ({model_name}): {error}")
    except (ValueError, AttributeError, TypeError) as error:
        print(f"Notice local Ollama returned an invalid response: {error}")
    return None


def call_llm_response(
    groq_client,
    messages: List[Dict[str, str]],
    preferred_model: Optional[str] = None,
    default_model: str = "openai/gpt-oss-20b",
    ollama_url: str = "http://127.0.0.1:11434",
    ollama_model: str = "llama3.2:3b",
    provider: Optional[str] = None,
) -> Tuple[Optional[str], str, str]:
    """Orchestrates LLM call across preferred model, fallbacks, and local Ollama.

    Returns (text_response, model_used, provider_used).
    """
    is_local = (provider == "local") or (
        preferred_model and preferred_model.startswith("local:")
    )
    target_model = preferred_model or default_model
    if target_model.startswith("local:"):
        target_model = target_model[6:].strip()
    elif target_model.startswith("groq:"):
        target_model = target_model[5:].strip()

    # Local Ollama branch
    if is_local:
        local_model_name = target_model or ollama_model
        local_response = generate_local_response(
            messages, ollama_url, local_model_name
        )
        if local_response:
            return local_response, local_model_name, "local"
        return (
            f"Could not generate a response using local model '{local_model_name}'. "
            f"Please verify Ollama is running and has the model installed (run 'ollama pull {local_model_name}').",
            local_model_name,
            "local",
        )

    # Cloud Groq branch
    cloud_model = target_model or default_model
    candidate_models = [cloud_model]
    if default_model not in candidate_models:
        candidate_models.append(default_model)

    for model in candidate_models:
        try:
            if not groq_client:
                break
            response = groq_client.chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=2500,
            )
            raw_content = response.choices[0].message.content or ""
            if not raw_content and getattr(
                response.choices[0].message, "reasoning", None
            ):
                raw_content = response.choices[0].message.reasoning
            cleaned = re.sub(
                r"<think>.*?</think>", "", raw_content, flags=re.DOTALL
            )
            cleaned = re.sub(r"<think>.*", "", cleaned, flags=re.DOTALL)
            if cleaned.strip():
                return cleaned.strip(), model, "groq"
        except Exception as e:
            print(f"Notice generating response with {model}: {e}")
            continue

    # Fallback to local Ollama if Groq fails
    local_response = generate_local_response(messages, ollama_url, ollama_model)
    if local_response:
        return local_response, ollama_model, "local"

    return None, cloud_model, "groq"
