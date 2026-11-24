# PRAG-TUTOR

PRAG-TUTOR (Personalized Retrieval-Augmented Generation Tutor) is a course-based tutoring app. Teachers upload the material they teach and review the prerequisite links between topics. Students ask questions about a subject, inspect the passages behind an answer, and take quizzes that inform later explanations.

For example, two students can ask the same DSA question about binary search. The tutor can skip an introduction to arrays for a student who has already demonstrated mastery, or give a refresher when that student's estimated mastery has declined. The student can also choose beginner, intermediate, or expert explanations.

## Run locally on Windows

1. Run `setup.bat` from the repository root to install dependencies and create the root `.env` file.
2. Configure MongoDB, a Pinecone index, and the model provider as described in the [setup guide](documentation/SETUP.md).
3. Run `run.bat` and open the URL printed by the frontend console (normally `http://localhost:5173`).

For a first walkthrough, choose the DSA teacher demo account and upload a course PDF. Once indexing finishes, sign in as the student Alice, open **Data Structures & Algorithms**, and ask a question covered by that PDF. **Completed Topics** shows mastery for the open subject. The subject hub also has a **Topic Mastery** view for browsing across subjects.

## Repository guide

| Directory | What lives there |
| --- | --- |
| [frontend](frontend/) | React student and teacher workspaces, chat, quizzes, and mastery views |
| [backend](backend/) | Express API, accounts, uploads, conversations, quiz scoring, and learner profiles |
| [tutor](tutor/) | Python service for document processing, prerequisite graphs, retrieval, and answer generation |
| `uploads/` | Runtime storage for subject PDFs and extracted images |
| [documentation](documentation/) | Setup, architecture, technology choices, and evaluation notes |

## Research status

The repository includes a pilot with 60 Data Structures & Algorithms questions across three difficulty levels. A research question this system can support is whether quiz-derived mastery helps the tutor choose which prerequisites to explain. The pilot records generated answers and automated scores. Testing that question requires a controlled comparison, and measuring learning gains requires student outcome data. The [evaluation FAQ](documentation/FAQ.md#what-does-the-dsa-evaluation-measure) explains how to interpret the saved results.

## Documentation

- [Setup and first run](documentation/SETUP.md)
- [Architecture and data flow](documentation/ARCHITECTURE.md)
- [Technology stack](documentation/TECHSTACK.md)
- [Usage, troubleshooting, and evaluation FAQ](documentation/FAQ.md)
