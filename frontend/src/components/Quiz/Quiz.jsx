import { useState } from 'react'
import { Check, ArrowRight, ArrowLeft, AlertCircle, Sparkles, Loader2 } from 'lucide-react'
import { apiFetch } from '../../api'

export default function Quiz({
  questions = [],
  quizSetIds = [],
  conversationId = null,
  studentUsername,
  subject,
  onComplete,
  currentIndex,
  answers,
  onProgress,
  compulsory = false,
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const totalQuestions = questions.length
  const currentQ = questions[currentIndex]
  const isFirstQuestion = currentIndex === 0
  const isLastQuestion = currentIndex === totalQuestions - 1
  const progressPercent = totalQuestions > 0 ? Math.round(((currentIndex + 1) / totalQuestions) * 100) : 0
  const selectedOption = currentQ ? (answers[currentQ.question_id] || '') : ''

  const handleSelectOption = (option) => {
    if (!submitting && currentQ) {
      onProgress({ answers: { ...answers, [currentQ.question_id]: option } })
    }
  }

  const handleNext = () => {
    if (currentIndex < totalQuestions - 1) {
      onProgress({ currentIndex: currentIndex + 1 })
    }
  }

  const handlePrevious = () => {
    if (currentIndex > 0) {
      onProgress({ currentIndex: currentIndex - 1 })
    }
  }

  const handleSubmitQuiz = async () => {
    if (submitting) return

    if (!selectedOption) {
      setError('Please select an option before submitting.')
      return
    }

    try {
      setSubmitting(true)
      setError(null)

      const answersPayload = questions.map((q, idx) => ({
        questionIndex: idx,
        question_id: q.question_id,
        selectedAnswer: answers[q.question_id] || (q.question_id === currentQ?.question_id ? selectedOption : ''),
      })).filter((a) => a.selectedAnswer)

      console.log(`[QUIZ SUBMIT] Submitting ${answersPayload.length} answers for ${totalQuestions} questions`)

      const res = await apiFetch('/api/quiz/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentUsername,
          subject,
          conversationId,
          quizSetIds,
          answers: answersPayload,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit quiz.')
      }

      console.log(`[QUIZ RESULT] Authoritative score: ${data.score}/${data.total}`)

      onComplete(data.score, data.total, {
        score: data.score,
        total: data.total,
        attemptId: data.attemptId,
      })
    } catch (err) {
      console.error('Quiz submission error:', err)
      setError(err.message || 'Error submitting quiz. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!questions || questions.length === 0) {
    return (
      <div className="quiz-card w-full max-w-2xl rounded-2xl border border-line bg-panel p-6 shadow-xs">
        <p className="text-sm text-dim">No questions available for this quiz.</p>
      </div>
    )
  }

  const optionLetters = ['A', 'B', 'C', 'D']

  return (
    <div
      className={`quiz-card w-full max-w-2xl rounded-2xl border p-6 shadow-xs animate-rise transition ${
        compulsory
          ? 'quiz-card-compulsory border-warn/40 bg-warn/5'
          : 'border-line bg-panel'
      }`}
      id="active-quiz-container"
    >
      <div className="quiz-card-header flex items-center justify-between gap-3 mb-5">
        <div className="quiz-badge-wrap">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
              compulsory
                ? 'badge-prereq border-warn/30 bg-warn/10 text-warn'
                : 'badge-topic border-accent/20 bg-accent-soft text-accent-strong'
            }`}
          >
            {compulsory ? (
              <AlertCircle size={13} className="text-warn shrink-0" />
            ) : (
              <Sparkles size={13} className="text-accent shrink-0" />
            )}
            <span className="badge-label">
              {compulsory ? 'Compulsory Knowledge Check' : 'Concept Check'} — Question {currentIndex + 1} of {totalQuestions}
            </span>
          </span>
        </div>

        <div className="quiz-progress-track h-2 w-32 rounded-full bg-raised overflow-hidden border border-line" title={`Question ${currentIndex + 1} of ${totalQuestions}`}>
          <div
            className="quiz-progress-fill h-full bg-accent transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div className="quiz-question-container mb-6">
        <h4 className="quiz-question-text text-base font-semibold leading-snug text-fg mb-4" id="quiz-question-text">
          {currentQ?.question}
        </h4>

        <div className="quiz-options-list flex flex-col gap-2.5" role="radiogroup">
          {(currentQ?.options || []).map((opt, oIdx) => {
            const isSelected = selectedOption === opt
            const letter = optionLetters[oIdx] || String(oIdx + 1)

            return (
              <button
                key={oIdx}
                type="button"
                className={`quiz-option-btn group flex w-full items-center gap-3.5 rounded-xl border p-3.5 text-left text-sm transition ${
                  isSelected
                    ? 'selected border-accent bg-accent-soft text-accent-strong font-medium shadow-2xs'
                    : 'border-line bg-raised text-fg hover:border-line-strong hover:bg-hover'
                }`}
                onClick={() => handleSelectOption(opt)}
                disabled={submitting}
                role="radio"
                aria-checked={isSelected}
                id={`quiz-opt-${oIdx}`}
              >
                <span
                  className={`quiz-option-letter flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border text-xs font-bold transition ${
                    isSelected
                      ? 'border-accent bg-accent text-white'
                      : 'border-line bg-panel text-mute group-hover:text-fg'
                  }`}
                >
                  {isSelected ? <Check size={13} /> : letter}
                </span>
                <span className="quiz-option-text flex-1 leading-snug">{opt}</span>
              </button>
            )
          })}
        </div>
      </div>

      {error && (
        <div className="quiz-error-msg mb-4 rounded-xl border border-danger/20 bg-danger/10 px-3.5 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <div className="quiz-actions-row flex items-center gap-3 pt-2">
        <button
          type="button"
          className="quiz-btn-secondary inline-flex items-center gap-2 rounded-xl border border-line bg-raised px-4 py-2 text-sm font-medium text-dim transition hover:bg-hover hover:text-fg disabled:opacity-40"
          onClick={handlePrevious}
          disabled={isFirstQuestion || submitting}
          id="quiz-prev-btn"
        >
          <ArrowLeft size={15} />
          <span>Previous</span>
        </button>

        {isLastQuestion ? (
          <button
            type="button"
            className="quiz-btn-primary inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white shadow-xs transition hover:bg-accent-strong disabled:opacity-50"
            onClick={handleSubmitQuiz}
            disabled={submitting || !selectedOption}
            id="quiz-submit-btn"
          >
            {submitting ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                <span>Scoring Quiz...</span>
              </>
            ) : (
              <>
                <span>Submit Quiz</span>
                <Check size={15} />
              </>
            )}
          </button>
        ) : (
          <button
            type="button"
            className="quiz-btn-primary inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white shadow-xs transition hover:bg-accent-strong disabled:opacity-50"
            onClick={handleNext}
            disabled={submitting || !selectedOption}
            id="quiz-next-btn"
          >
            <span>Next</span>
            <ArrowRight size={15} />
          </button>
        )}

        <span className="ml-auto text-xs font-mono text-mute">
          Question {currentIndex + 1} of {totalQuestions}
        </span>
      </div>
    </div>
  )
}
