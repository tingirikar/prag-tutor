# PRAG-TUTOR
it means Personlised RAG (Retrieval Augmented Generation) Tutor
so what it means is, it is RAG + Personalization
Personalization means
- how much concept depth u want (beginner / intermediate / expert)
- prerequisites (there is prerequistes option)
- learner modelling (what students knows, what is his mastery in that concept)

## Documentation
- [Installation & Setup Guide](SETUP.md)
- [System Architecture](ARCHITECTURE.md)
- [Tech Stack Details](TECHSTACK.md)
- [Frequently Asked Questions (FAQ)](FAQ.md)

## PRAG-TUTOR architecture
so there are 4 folders
```
- frontend/   # User Interface
- backend/    # WEB logic
- tutor/      # AI Engine
- uploads/    # documents uploaded by teachers
```
## USERS
there are two users, students and teachers
#### teachers
- teachers can upload documents (currently restricted to pdf)
- those documents are stored in uploads/ folder
- those documents are chunked, embedded (using EMBEDDING MODEL) and those embeddings are 
indexed and stored in pinecone vector database
- images are also extracted from those documents

#### students
- 

## WHY PRAG-TUTOR STANDS OUT
> current AI like chatgpt, gemini, claude, etc..
- we have to upload documents to get relevant explanations
- they are trained on vast internet, so generated content feels outside
- it has context, but is not focused on learning, its focused on general
- it doesnt tract what user knows
ex: if i ask it about 

> PRAG-TUTOR 🔥
- beginner / intermediate / expert level personalization
- Learner modelling supports what students knows
- prerequiste button helps them to learn prior concepts so learning becomes easy
