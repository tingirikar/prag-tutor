"""Shared configuration, environment variables, and singleton service clients.

Loads .env ONCE and provides lazy singletons for MongoDB, Pinecone,
Groq, and SentenceTransformer so every module shares a single connection.
"""

import os
from dotenv import load_dotenv

# ── Paths ──────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, ".."))

UPLOAD_DIR = os.path.join(PROJECT_ROOT, "uploads")
if not os.path.exists(UPLOAD_DIR) and os.path.exists(os.path.join(BASE_DIR, "uploads")):
    UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ── Environment Variables (loaded once) ────────────────────────────────
load_dotenv(os.path.join(PROJECT_ROOT, ".env"))
load_dotenv(os.path.join(BASE_DIR, ".env"))

PINECONE_API_KEY = os.environ.get("PINECONE_API_KEY", "").strip()
PINECONE_INDEX = os.environ.get("PINECONE_INDEX", "").strip()
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
OLLAMA_URL = 'http://127.0.0.1:11434'
OLLAMA_MODEL = 'llama3.2:3b'

# ── MongoDB Singleton ─────────────────────────────────────────────────
_mongo_client = None
_mongo_db = None


def get_db():
    """Returns the MongoDB database handle (lazy singleton with local fallback)."""
    global _mongo_client, _mongo_db
    if _mongo_db is not None:
        return _mongo_db
    
    import pymongo
    uri = os.environ.get("MONGODB_URI", "").strip()
    if uri:
        try:
            client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=3000)
            client.admin.command('ping')
            _mongo_client = client
            try:
                _mongo_db = _mongo_client.get_default_database()
            except Exception:
                _mongo_db = _mongo_client["lpi_tutor"]
            return _mongo_db
        except Exception as e:
            print(f"[Warning] Configured MongoDB connection failed: {e}. Falling back to local MongoDB...")

    # Fallback to local MongoDB (consistent with backend/config/db.js)
    try:
        local_client = pymongo.MongoClient("mongodb://127.0.0.1:27017/lpi_tutor", serverSelectionTimeoutMS=3000)
        local_client.admin.command('ping')
        _mongo_client = local_client
        _mongo_db = local_client["lpi_tutor"]
        print("Connected successfully to local MongoDB (lpi_tutor).")
        return _mongo_db
    except Exception as e:
        print(f"[Warning] Local MongoDB connection failed: {e}")
        return None


# ── Pinecone Index Singleton ──────────────────────────────────────────
_pinecone_index = None

def get_pinecone_index():
    """Returns the Pinecone index handle (lazy singleton)."""
    global _pinecone_index
    if _pinecone_index is not None:
        return _pinecone_index
    if not PINECONE_API_KEY:
        print("[Warning] PINECONE_API_KEY is not set. Vector search will be unavailable.")
        return None
    try:
        import pinecone

        pc = pinecone.Pinecone(api_key=PINECONE_API_KEY)
        _pinecone_index = pc.Index(PINECONE_INDEX)
        return _pinecone_index
    except Exception as e:
        print(f"[Warning] Failed to connect to Pinecone: {e}")
        return None


# ── Groq Client Singleton ─────────────────────────────────────────────
_groq_client = None


def get_groq_client():
    """Returns the Groq LLM client (lazy singleton)."""
    global _groq_client
    if _groq_client is not None:
        return _groq_client
    if not GROQ_API_KEY:
        print("[Warning] GROQ_API_KEY is not set. LLM responses will be unavailable.")
        return None
    try:
        from groq import Groq

        _groq_client = Groq(api_key=GROQ_API_KEY)
        return _groq_client
    except Exception as e:
        print(f"[Warning] Failed to create Groq client: {e}")
        return None


# ── Embedding Model Singleton ─────────────────────────────────────────
_embedding_model = None


def get_embedding_model():
    """Loads the SentenceTransformer embedding model (lazy singleton with retry)."""
    global _embedding_model
    if _embedding_model is not None:
        return _embedding_model

    from sentence_transformers import SentenceTransformer

    max_retries = 3
    for attempt in range(max_retries):
        try:
            print(f"Loading embedding model (attempt {attempt + 1}/{max_retries})...")
            _embedding_model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
            print("Embedding model loaded successfully.")
            return _embedding_model
        except Exception as e:
            print(f"[Warning] Embedding model load failed (attempt {attempt + 1}): {e}")
            if attempt < max_retries - 1:
                import time

                time.sleep(5)
    print("[Critical] Failed to load embedding model after all retries.")
    return None
