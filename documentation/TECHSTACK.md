# Technology stack

| Layer | Technology | Role in PRAG-TUTOR |
| --- | --- | --- |
| Browser app | React, React Router, Vite | Teacher and student workspaces, subject navigation, chats, and quizzes |
| Interface | Tailwind CSS, Lucide React | Responsive layouts, icons, and interaction states |
| Answer rendering | React Markdown, remark-gfm, KaTeX, Mermaid | Markdown explanations, tables, mathematical notation, and generated diagrams |
| Application API | Node.js, Express, Multer | Authentication, role and subject checks, PDF uploads, and coordination with the tutor |
| Accounts and learner records | MongoDB, Mongoose, PyMongo | User accounts, subject documents, prerequisites, conversations, quiz attempts, and mastery records |
| Authentication | bcrypt, JSON Web Tokens | Password verification and signed sessions |
| Tutor service | Python, FastAPI, Uvicorn, Pydantic | Request validation, indexing, retrieval, and generation endpoints |
| PDF processing | pdfplumber, PyMuPDF, Pillow | Page text, embedded images, and image filtering |
| Semantic search | Sentence Transformers, PyTorch, Pinecone | Embed course text and questions with `all-MiniLM-L6-v2` and retrieve passages by subject |
| Generation | Groq API, Ollama | Cloud and local answer generation |
| Evaluation | Python, NumPy, Matplotlib | Score saved or live responses and plot the DSA pilot comparison |

## Dependency and implementation references

- [Frontend package manifest](../frontend/package.json) and [Vite configuration](../frontend/vite.config.js)
- [Backend package manifest](../backend/package.json) and [server entry point](../backend/server.js)
- [Tutor requirements](../tutor/requirements.txt) and [model configuration](../tutor/config.py)
- [Evaluation script](../tutor/evaluate_prag_tutor.py). It imports Matplotlib, which is an additional dependency for running the evaluator.

For the service ports, environment variables, and startup commands, see the [setup guide](SETUP.md).
