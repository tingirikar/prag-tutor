import { useState } from 'react'
import { Sparkles, ArrowRight, Loader2, HelpCircle } from 'lucide-react'
import { apiFetch } from '../../api'

export default function QuizInvite({
  quizSetId,
  conversationId = null,
  studentUsername,
  subject,
  total = 6,
  onYes,
  onNo,
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleDecision = async (decision) => {
    try {
      setLoading(true)
      setError(null)
      const res = await apiFetch('/api/quiz/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentUsername,
          subject,
          quizSetId,
          conversationId,
          decision,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to record decision')
      }

      if (decision === 'yes') {
        onYes({
          quizSetIds: data.quizSetIds,
          questions: data.questions,
          total: data.total,
        })
      } else {
        onNo()
      }
    } catch (err) {
      console.error('Quiz decision error:', err)
      setError(err.message || 'Error processing quiz decision')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="quiz-invite-card w-full max-w-2xl rounded-2xl border border-line bg-panel p-6 shadow-xs animate-rise">
      <div className="quiz-card-header flex items-center justify-between gap-3 mb-4">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-strong">
          <Sparkles size={13} className="text-accent" />
          <span>Concept Check ({total} Questions)</span>
        </span>
      </div>

      <div className="quiz-invite-content space-y-2 mb-5">
        <h3 className="text-base font-semibold text-fg tracking-tight">
          Do you want to attempt a quiz?
        </h3>
        <p className="text-sm leading-relaxed text-dim">
          Test your understanding of the concepts covered in this explanation with a quick {total}-question assessment based strictly on this lesson.
        </p>
      </div>

      {error && (
        <div className="quiz-error-msg mb-4 rounded-xl border border-danger/20 bg-danger/10 px-3.5 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <div className="quiz-actions-row flex items-center gap-3">
        <button
          type="button"
          className="quiz-btn-primary inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white shadow-xs transition hover:bg-accent-strong disabled:opacity-50"
          onClick={() => handleDecision('yes')}
          disabled={loading}
          id="quiz-invite-yes-btn"
        >
          {loading ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              <span>Starting Quiz...</span>
            </>
          ) : (
            <>
              <span>YES</span>
              <ArrowRight size={15} />
            </>
          )}
        </button>

        <button
          type="button"
          className="quiz-btn-secondary inline-flex items-center gap-2 rounded-xl border border-line bg-raised px-4 py-2 text-sm font-medium text-dim transition hover:bg-hover hover:text-fg disabled:opacity-50"
          onClick={() => handleDecision('no')}
          disabled={loading}
          id="quiz-invite-no-btn"
        >
          <span>NO</span>
        </button>
      </div>
    </div>
  )
}
