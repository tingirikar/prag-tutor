export const pythonUrl = (process.env.PYTHON_RAG_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')

export async function callPython(endpoint, options = {}) {
  const timeout = options.timeout || 120000 // Default 2 minute timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(`${pythonUrl}${endpoint}`, {
      ...options,
      signal: controller.signal
    })
    clearTimeout(timeoutId)

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(payload.detail || payload.error || `Python service returned ${response.status}`)
      error.status = response.status
      throw error
    }
    return payload
  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      const timeoutError = new Error(`Python service request timed out after ${timeout}ms`)
      timeoutError.status = 504
      throw timeoutError
    }
    throw error
  }
}

/**
 * Diagnoses the conceptual misconception behind a chosen distractor by calling Python RAG endpoint.
 * Falls back deterministically if unreachable or on timeout.
 */
export async function diagnoseMisconception({ topic = '', question = '', selectedAnswer = '', correctAnswer = '' }) {
  const fallback = `Confused '${selectedAnswer}' with '${correctAnswer}' regarding ${topic} (${question})`
  try {
    const payload = await callPython('/learner/diagnose-misconception', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: String(topic || ''),
        question: String(question || ''),
        selected_answer: String(selectedAnswer || ''),
        correct_answer: String(correctAnswer || ''),
      }),
      timeout: 10000,
    })

    if (payload && payload.misconception && typeof payload.misconception === 'string') {
      return payload.misconception.trim()
    }
  } catch (error) {
    console.warn(`[pythonService] Falling back to default diagnosis: ${error.message}`)
  }
  return fallback
}

