# Windows setup

Run these commands from the repository root in PowerShell. You need Python 3.10 or later and Node.js with npm. Node.js 22.12 or later satisfies the frontend's Vite runtime requirement.

## Install dependencies

```powershell
.\setup.bat
```

The script creates `tutor\.venv`, installs the tutor's Python requirements, and runs `npm ci` separately in `backend` and `frontend`. On first setup it copies `.env.example` to `.env`. Run it again after dependency changes.

## Configure the services

Edit the root `.env`. Use the [environment template](../.env.example) for the variable names.

| Setting | What to supply |
| --- | --- |
| `MONGODB_URI`, `DB_NAME` | Use a running local MongoDB instance or your MongoDB connection URI. For a local setup the default address is `127.0.0.1:27017` and the database is `prag-tutor`. Both services need the same database. |
| `PINECONE_API_KEY`, `PINECONE_INDEX` | Provide a key and the name of an existing dense index for the 384-dimensional MiniLM embeddings. Use cosine similarity. The tutor writes each subject into its own namespace. |
| `GROQ_API_KEY` | Supply a Groq key for the cloud generation path, including prerequisite generation. |
| `GROQ_FALLBACK_API_KEY`, `GROQ_JUDGE_API_KEY` | Optional keys for generation fallback and the evaluation judge, respectively. |
| `AUTH_SECRET` | Set a private random value for signing login tokens. The API requires it in production mode. |

For local chat generation, start Ollama on `http://127.0.0.1:11434`, install a model (for example, `ollama pull llama3.2:3b`), and select it in the chat composer. The Python tutor uses this fixed local address. The Node quiz service can also read `OLLAMA_URL` and `OLLAMA_MODEL`. Local generation still uses Pinecone for course retrieval.

## Start the app

```powershell
.\run.bat
```

The launcher opens three consoles. The first tutor startup may take longer while Sentence Transformers downloads the embedding model.

| Service | Default address | What to check |
| --- | --- | --- |
| Frontend | `http://localhost:5173` | Open the local URL printed by Vite. It may choose the next port if this one is occupied. |
| Express API | `http://127.0.0.1:5000/health` | Look for `"mongo": true` to confirm that the app can save data. |
| Python tutor | `http://127.0.0.1:8000/health` | Check the embedding model and processor status. Interactive API docs are at `/docs`. |

To run a single service while debugging, use the matching command from the indicated directory.

| Directory | PowerShell command |
| --- | --- |
| `tutor` | `.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload` |
| `backend` | `npm.cmd run dev` |
| `frontend` | `npm.cmd run dev` |

## Try a complete lesson

1. Choose **Teacher** on the login screen and select the DSA demo account. Upload a PDF containing selectable text and wait for **Completed & Indexed**. Review the generated prerequisites.
2. Sign out, choose **Student**, and select Alice. Open DSA and ask about a topic covered in the PDF. Inspect the source snippets alongside the answer.
3. Take a quiz when offered, then open **Completed Topics** in DSA to see the topic-level estimates. Use the [FAQ](FAQ.md) if sources or topics are missing.

Stop each development server with Ctrl+C in its console.
