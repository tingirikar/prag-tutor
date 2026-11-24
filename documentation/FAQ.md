# Frequently asked questions

## What happens when a teacher uploads a PDF?

The teacher's assigned subject determines where the file is saved and indexed. For DSA, PDFs live under `uploads/dsa/documents/` and extracted images under `uploads/dsa/images/`. The browser shows indexing progress while the tutor processes pages, embeds chunks, and generates prerequisite links. Once processing finishes, review the topics and prerequisites before using them in a lesson. [Indexing flow](ARCHITECTURE.md#from-a-pdf-to-a-course-graph)

## Why does the tutor have no useful sources for my question?

First check that the PDF finished indexing in the same subject as the chat. Try a question whose answer appears in the PDF's selectable text. If retrieval still fails, check the Python console for embedding or Pinecone errors and verify the index name and dimensions. A successful login confirms access to the application, while indexing and retrieval depend on separate services. [Setup checks](SETUP.md#start-the-app)

## How do difficulty, quiz score, and mastery differ?

Difficulty is a student preference controlling explanation depth. A quiz score counts correct answers on that attempt. Mastery is an estimate based on observations over time. A topic can become due for a refresher even after an earlier successful quiz. A wrong answer can suggest a misconception for the tutor to address in a later explanation. [Learner update flow](ARCHITECTURE.md#from-a-quiz-to-the-next-question)

## Where can a student see progress?

Inside a subject, open **Completed Topics** for that subject's mastered topics, topics to learn, and quiz summary. From the subject hub, **Topic Mastery** lets the student select a subject. **Learn with Tutor** opens a chat prompt for the chosen topic.

## What does the DSA evaluation measure?

The saved pilot contains 60 question–answer cases covering 10 chapters, with 20 questions at each of three difficulty levels. Each case supplies a reference answer, expected prerequisites, and a list of mastered topics. The evaluator calls the tutor directly. It passes that list and leaves out the richer quiz-derived learner profile that the application sends. [Dataset](../tutor/dsa_eval_dataset.json) · [Saved responses](../tutor/eval_checkpoint.json) · [Evaluator](../tutor/evaluate_prag_tutor.py)

Read the results as a pilot for finding errors. For example, case `E01` asks about Cook's theorem. The saved answer introduces B*-trees as a prerequisite and still receives 80% prerequisite F1. The scorer gives precision credit for a predicted label of at least three characters. The mastery-filtering score also gives full credit for an empty recommendation list. Inspect the suggested prerequisites and the answer text when assessing either score.

The comparison chart uses fixed numbers for the other systems. The satisfaction score comes from the automated evaluator, which can fall back to heuristics. Claims about relative performance need baselines run on the same tasks. Claims about satisfaction or learning gains need observations from students. [Comparison chart](prag_tutor_fig4.png) · [LPITutor reference paper](LPITutor.pdf)

## What research question could this project test?

Does adding quiz-derived mastery help a course-grounded tutor explain the prerequisites a learner needs? Hold the DSA question, model, and retrieved passages fixed. Compare retrieval alone, retrieval with a prerequisite graph, and retrieval with the graph plus a learner profile. Ask instructors who do not know which version generated each answer to mark missing, redundant, and unrelated prerequisites. This would test the tutor's instructional choices under controlled conditions.
