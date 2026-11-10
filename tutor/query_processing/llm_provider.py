"""LLM provider integration: Groq cloud client with model fallbacks and local Ollama execution."""

import os
import re
from typing import Any, Dict, List, Optional, Tuple

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
            },
            timeout=90,
        )
        if response.status_code == 404:
            return (
                f"Local Ollama model '{model_name}' is not installed.\n\n"
                f"Please pull it first by opening a terminal and running:\n"
                f"```powershell\nollama pull {model_name}\n```"
            )
        if response.status_code == 200:
            result = response.json()
            local_text = result.get("message", {}).get("content", "").strip()
            print(f"Used local Ollama model '{model_name}'.")
            return local_text
    except Exception as error:
        print(f"Notice local Ollama unavailable ({model_name}): {error}")
    except (KeyError, ValueError) as error:
        print(f"Notice local Ollama returned an invalid response: {error}")
    return None


def call_llm_response(
    groq_client: Any,
    messages: List[Dict[str, str]],
    preferred_model: Optional[str] = None,
    default_model: Optional[str] = None,
    ollama_url: str = "http://127.0.0.1:11434",
    ollama_model: str = "llama3.2:3b",
    provider: Optional[str] = None,
) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """Orchestrates LLM call across preferred model, fallbacks, and local Ollama.

    Returns:
        (text_response, model_used, provider_used)
    """
    normalized_provider = (provider or "groq").strip().lower()
    target_model = preferred_model or default_model

    # Local Ollama branch
    if normalized_provider in ("local", "ollama"):
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

    # Cloud Groq branch with primary + fallback keys
    groq_fallbacks = ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"]
    candidate_models = []
    if target_model:
        candidate_models.append(target_model)
    if default_model and default_model not in candidate_models:
        candidate_models.append(default_model)
    for fm in groq_fallbacks:
        if fm not in candidate_models:
            candidate_models.append(fm)

    cloud_model = candidate_models[0] if candidate_models else "qwen/qwen3.8-27b"

    clients = []
    if groq_client:
        clients.append(groq_client)
    fallback_key = os.environ.get("GROQ_FALLBACK_API_KEY", "").strip()
    if fallback_key:
        try:
            from groq import Groq
            clients.append(Groq(api_key=fallback_key))
        except Exception as e:
            print(f"Notice initializing fallback Groq client: {e}")

    for client in clients:
        for model in candidate_models:
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    max_tokens=2500,
                )
                raw_content = response.choices[0].message.content or ""
                if not raw_content and getattr(
                    response.choices[0].message, "reasoning", None
                ):
                    raw_content = response.choices[0].message.reasoning or ""
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
