# Bug review — 18 November 2026

Demo users, displayed demo credentials, and their continued availability are explicitly excluded from this review. Application source was not changed.

Validation: the running frontend (5173), Node API (5000), and Python service (8000) responded successfully; Node reported MongoDB ready. `npm.cmd run frontend:build` passed. The answer-key disclosure was reproduced against the running API. Quiz ownership/replay and stale-vector behavior were reproduced using the actual functions with in-memory dependencies, without changing stored student data. Remaining findings were established by tracing the source. Browser automation was unavailable, so visual and interactive browser testing was not completed.

## 1. High — Quiz IDs bypass ownership and subject checks

Locations: `backend/services/quizService.js:416`, `:489`, `:688`; `backend/routes/quizRoutes.js`.

The routes validate the username and subject supplied by the caller, but the service retrieves or modifies the referenced QuizSet by ID alone. `buildQuiz` ignores its studentUsername and subject arguments; `completeQuiz` similarly loads only by `_id`; `recordQuizSkip` updates only by `_id`.

Given another student's quiz ID, a student can retrieve its questions, mark it skipped/completed, and submit it under an enrolled subject of their choosing. An in-memory reproduction requested Alice's DSA quiz as Bob under ML; both question retrieval and scoring succeeded and the attempt was credited to Bob/ML.

Fix: scope all QuizSet reads and writes to the authenticated student, authorized subject, and appropriate status. Reject missing or mismatched IDs before modifying state.

## 2. High — Completed quizzes can repeatedly increase mastery

Location: `backend/services/quizService.js:688`.

Submission never excludes QuizSets already marked `completed`. Reposting the same answers scores the quiz again, creates another attempt, and runs the learner-model updates again. This can inflate mastery and memory stability without new assessment evidence. Reproduced by calling completeQuiz twice against an already completed in-memory QuizSet; both calls succeeded and wrote mastery updates.

Fix: atomically claim eligible quizzes for submission, reject completed quizzes, and make retries idempotent. A status check alone will still permit simultaneous submissions.

## 3. High — Saved conversations expose quiz answer keys

Locations: `backend/controllers/queryController.js:175`; `backend/controllers/conversationController.js:100`.

Full quiz questions, including `correctAnswer` and distractor diagnosis maps, are copied into `conversation.queries[].quiz_questions`. GET `/api/conversations/:id` spreads the full stored conversation into its response. Sanitizing the dedicated quiz endpoints therefore does not protect the answers.

Live reproduction: log in as Alice, list her conversations, then retrieve one containing a quiz. Its response contains `queries[].quiz_questions[].correctAnswer`.

Fix: return an explicit conversation DTO that omits answer keys and grading metadata, including nested historical query records.

## 4. High — Upload authorization happens after files are written

Locations: `backend/routes/documentRoutes.js:17`; `backend/middleware/upload.js:15`; `backend/controllers/documentController.js:18`.

Multer saves the file using the caller's subject and original filename before the controller checks whether the teacher owns that subject. A teacher can target another subject and overwrite an existing PDF, even though the request ultimately returns 403. The subject path also accepts traversal components before this check. Filename sanitization does not protect the directory path.

Fix: authorize and validate the destination before storage, derive the destination from the authenticated teacher, verify path containment, and use staged files with cleanup on failure. Do not test this against existing PDFs because the rejected request can still damage them.

## 5. Medium — PDF diagrams disappear after reloading a chat

Locations: `frontend/src/pages/StudentDashboard.jsx:476`; `backend/controllers/queryController.js:124`, `:295`.

The frontend assigns a fresh assistantMessageId after receiving an answer. The backend already stored that assistant message with a different random UUID. The subsequent `/api/query/images` request sends the frontend ID, but the persistence loop requires an exact match with the backend ID. No message matches, so diagrams can appear in the current UI but are never attached to the stored message.

Fix: return the stored assistant-message ID with the query response and reuse it in the frontend and image request.

## 6. Medium — Refreshing removes the active quiz before restoration

Location: `frontend/src/pages/StudentDashboard.jsx:343–361`.

On initial mount, quizMode is null. The first effect removes `student_active_quiz`; the following restoration effect then reads the now-empty key. The conversation response cannot restore it either: getConversationQuizStatus without a current quiz returns no questions and no IDs.

Reproduction: start a quiz and refresh the page. The saved active quiz is discarded.

Fix: initialize quiz state from storage before persistence runs, or delay persistence until restoration completes. Preserve the identity of the active quiz through conversation loading too.

## 7. Medium — Replacing a PDF leaves old chunks searchable

Location: `tutor/document_processing/indexing.py:63–84`.

Vectors use IDs based on subject, filename, and chunk index. Reindexing only upserts the new chunks; it never removes obsolete chunk IDs. Replacing a three-chunk PDF with a one-chunk PDF leaves chunks 1 and 2 from the old version. The active-document filter still accepts them because the filename remains valid.

Reproduced with the actual indexing function and an in-memory index: after uploading 3 chunks followed by 1, all 3 IDs remained.

Fix: replace document vectors using versioned ingestion and cleanup, or explicitly remove obsolete vectors after successful replacement.

## 8. Medium — Provider failures produce fabricated graded quizzes

Location: `backend/services/quizService.js:189–277`, `:329`.

Fallback questions extract the first long words from the explanation and insert them into fixed templates with hard-coded answers about data structures. They do not derive correct answers from lesson content and can be unrelated to the subject. These questions are nevertheless scored and update topic mastery and diagnosed misconceptions.

Live stored example: a quiz asks for the conceptual definition of “Before,” with the purported correct answer “It serves as a foundational component establishing the core properties of Before.”

Fix: when generation fails, omit the quiz or use validated subject-specific questions. Do not update learner models from fabricated fallback assessments.

## 9. Medium — Each strong quiz boosts prerequisites twice

Locations: `backend/services/quizService.js:849`, `:1032`, `:1070`.

For topic accuracy >= 80%, recordTopicMastery calls applyImplicitPrerequisiteReview. After that function returns, completeQuiz calls the same review again for the same topic. Each eligible prerequisite receives two mastery nudges for one assessment. For example, a prerequisite starting at 0.60 becomes 0.66144 instead of 0.632.

Fix: perform implicit prerequisite reinforcement once per assessed topic and submission.

## 10. Medium — Failed chat deletion is shown as successful

Location: `frontend/src/pages/StudentDashboard.jsx:280–290`.

confirmDelete awaits fetch but never checks response.ok. HTTP 401, 429, or 500 resolves normally, so the conversation is removed from the sidebar and the active chat may be cleared even though deletion failed. It reappears when history reloads.

Fix: check the HTTP result before changing UI state and display the returned error on failure.

## 11. Medium — Saved messages lose response metadata

Locations: `backend/controllers/queryController.js:129–131`; `backend/models/Conversation.js:9`.

The controller supplies exploreNext, rejected, and status on assistant messages, but the Mongoose message schema defines none of these fields. Default strict schema behavior discards them. On reload, Explore Next suggestions disappear and rejected responses lose their rejection metadata and related rendering behavior.

Fix: add the intended persisted fields to the schema and ensure their stored shape matches the frontend.
