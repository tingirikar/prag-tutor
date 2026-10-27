import { useState, useEffect, useMemo } from 'react'
import {
  Award,
  CheckCircle2,
  Clock,
  BookOpen,
  Sparkles,
  ArrowUpRight,
  Search,
  GraduationCap,
  Flame,
  Filter,
  RefreshCw,
  ChevronRight,
  TrendingUp,
} from 'lucide-react'
import SubjectIcon from '../ui/SubjectIcon'
import { apiFetch } from '../../api'

export default function TopicMasteryPanel({
  user,
  subjects = [],
  initialSubject = null,
  onStudyTopic = () => {},
}) {
  const [selectedSubjectCode, setSelectedSubjectCode] = useState(
    initialSubject?.code || subjects[0]?.code || 'DSA'
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [masteryData, setMasteryData] = useState({
    stats: { totalTopics: 0, masteredCount: 0, remainingCount: 0, progressPercentage: 0, averageScore: 0 },
    masteredTopics: [],
    remainingTopics: [],
    allTopics: [],
  })
  const [filter, setFilter] = useState('all') // 'all' | 'completed' | 'remaining'
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (initialSubject?.code) {
      setSelectedSubjectCode(initialSubject.code)
    }
  }, [initialSubject])

  const fetchMastery = async (subjectCode) => {
    setLoading(true)
    setError(null)
    try {
      const code = subjectCode || selectedSubjectCode
      const query = code ? `?subject=${encodeURIComponent(code)}` : ''
      const res = await apiFetch(`/api/quiz/mastery${query}`)
      if (!res.ok) {
        throw new Error('Failed to load topic mastery data')
      }
      const data = await res.json()
      setMasteryData({
        stats: data.stats || { totalTopics: 0, masteredCount: 0, remainingCount: 0, progressPercentage: 0, averageScore: 0 },
        masteredTopics: data.masteredTopics || [],
        remainingTopics: data.remainingTopics || [],
        allTopics: data.allTopics || [],
      })
    } catch (err) {
      console.error('Error fetching mastery:', err)
      setError(err.message || 'Could not fetch topic mastery data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (selectedSubjectCode) {
      fetchMastery(selectedSubjectCode)
    }
  }, [selectedSubjectCode])

  const currentSubjectObj = useMemo(() => {
    return subjects.find((s) => s.code === selectedSubjectCode) || {
      code: selectedSubjectCode,
      name: selectedSubjectCode,
    }
  }, [subjects, selectedSubjectCode])

  // Filter & search topics
  const displayedTopics = useMemo(() => {
    let list = masteryData.allTopics || []
    if (filter === 'completed') {
      list = list.filter((t) => t.isMastered)
    } else if (filter === 'remaining') {
      list = list.filter((t) => !t.isMastered)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(
        (t) =>
          t.topic?.toLowerCase().includes(q) ||
          t.prerequisites?.some((p) => p.toLowerCase().includes(q))
      )
    }
    return list
  }, [masteryData.allTopics, filter, searchQuery])

  const formatDate = (isoString) => {
    if (!isoString) return ''
    try {
      return new Date(isoString).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    } catch {
      return ''
    }
  }

  const { stats } = masteryData

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 sm:px-8">
      {/* Subject Header & Subject Selector Pills */}
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] font-semibold tracking-[0.16em] text-accent uppercase">
            <GraduationCap size={15} />
            <span>Learner Model • Curriculum Mastery</span>
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-fg sm:text-3xl">
            Topic Progress & Completed Syllabus
          </h1>
          <p className="mt-1 text-sm text-dim">
            Track topics you have mastered through adaptive quizzes and see what to learn next.
          </p>
        </div>

        {/* Subject Pills */}
        {subjects.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-line bg-panel/80 p-1.5 shadow-xs backdrop-blur-sm">
            {subjects.map((sub) => {
              const active = sub.code === selectedSubjectCode
              return (
                <button
                  key={sub.code}
                  type="button"
                  onClick={() => setSelectedSubjectCode(sub.code)}
                  className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${
                    active
                      ? 'bg-accent text-white shadow-xs font-semibold'
                      : 'text-dim hover:bg-hover hover:text-fg'
                  }`}
                >
                  <SubjectIcon code={sub.code} size={14} />
                  <span>{sub.code}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Progress Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Progress % Card */}
        <div className="relative overflow-hidden rounded-2xl border border-line bg-panel p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10.5px] font-semibold tracking-[0.16em] text-mute uppercase">
              Curriculum Mastered
            </span>
            <span className="grid size-8 place-items-center rounded-xl bg-accent/10 text-accent">
              <TrendingUp size={16} />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-display text-3xl font-bold tracking-tight text-fg">
              {stats.progressPercentage}%
            </span>
            <span className="text-xs text-dim">
              ({stats.masteredCount} of {stats.totalTopics} topics)
            </span>
          </div>
          {/* Progress bar */}
          <div className="mt-3.5 h-2 w-full overflow-hidden rounded-full bg-raised">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent to-emerald-400 transition-all duration-700 ease-out"
              style={{ width: `${Math.min(stats.progressPercentage, 100)}%` }}
            />
          </div>
        </div>

        {/* Completed Topics */}
        <div className="relative overflow-hidden rounded-2xl border border-line bg-panel p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10.5px] font-semibold tracking-[0.16em] text-mute uppercase">
              Completed Topics
            </span>
            <span className="grid size-8 place-items-center rounded-xl bg-emerald-500/10 text-emerald-400">
              <CheckCircle2 size={16} />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-display text-3xl font-bold tracking-tight text-emerald-400">
              {stats.masteredCount}
            </span>
            <span className="text-xs text-dim">topics mastered</span>
          </div>
          <p className="mt-3 text-[12px] text-mute">
            {stats.masteredCount > 0
              ? 'Proven mastery via passed quizzes (>50%)'
              : 'Pass subject quizzes to master topics'}
          </p>
        </div>

        {/* Remaining Topics */}
        <div className="relative overflow-hidden rounded-2xl border border-line bg-panel p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10.5px] font-semibold tracking-[0.16em] text-mute uppercase">
              Remaining Topics
            </span>
            <span className="grid size-8 place-items-center rounded-xl bg-amber-500/10 text-amber-400">
              <Clock size={16} />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-display text-3xl font-bold tracking-tight text-amber-300">
              {stats.remainingCount}
            </span>
            <span className="text-xs text-dim">topics pending</span>
          </div>
          <p className="mt-3 text-[12px] text-mute">
            Ready to study and assess with your AI tutor
          </p>
        </div>

        {/* Mastery Accuracy */}
        <div className="relative overflow-hidden rounded-2xl border border-line bg-panel p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10.5px] font-semibold tracking-[0.16em] text-mute uppercase">
              Avg Mastery Score
            </span>
            <span className="grid size-8 place-items-center rounded-xl bg-purple-500/10 text-purple-400">
              <Award size={16} />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-display text-3xl font-bold tracking-tight text-purple-300">
              {stats.averageScore ? `${stats.averageScore}%` : '—'}
            </span>
            <span className="text-xs text-dim">quiz accuracy</span>
          </div>
          <p className="mt-3 text-[12px] text-mute">
            Best scores across completed topics
          </p>
        </div>
      </div>

      {/* Control Bar: Filters + Search + Refresh */}
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-3.5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scroll-none">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
              filter === 'all'
                ? 'bg-fg text-bg font-semibold'
                : 'text-dim hover:bg-hover hover:text-fg'
            }`}
          >
            All Topics ({masteryData.allTopics.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('completed')}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition ${
              filter === 'completed'
                ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40 font-semibold'
                : 'text-dim hover:bg-hover hover:text-fg'
            }`}
          >
            <CheckCircle2 size={13} className="text-emerald-400" />
            <span>Mastered ({masteryData.masteredTopics.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setFilter('remaining')}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition ${
              filter === 'remaining'
                ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40 font-semibold'
                : 'text-dim hover:bg-hover hover:text-fg'
            }`}
          >
            <Clock size={13} className="text-amber-400" />
            <span>To Learn ({masteryData.remainingTopics.length})</span>
          </button>
        </div>

        {/* Search & Refresh */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute"
            />
            <input
              type="text"
              placeholder="Search topics..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-line bg-raised py-1.5 pl-8 pr-3 text-xs text-fg placeholder:text-mute focus:border-accent focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => fetchMastery(selectedSubjectCode)}
            disabled={loading}
            title="Refresh Mastery Data"
            className="grid size-8 shrink-0 place-items-center rounded-xl border border-line bg-raised text-dim transition hover:border-accent hover:text-fg disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Topics Content List */}
      {loading ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 text-dim">
          <RefreshCw size={24} className="animate-spin text-accent" />
          <span className="text-sm">Loading your topic mastery records...</span>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-center text-sm text-red-300">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => fetchMastery(selectedSubjectCode)}
            className="mt-3 rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-medium hover:bg-red-500/30"
          >
            Try Again
          </button>
        </div>
      ) : displayedTopics.length === 0 ? (
        <div className="rounded-2xl border border-line bg-panel p-12 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent/10 text-accent">
            <BookOpen size={24} />
          </div>
          <h3 className="mt-4 font-display text-lg font-bold text-fg">
            {filter === 'completed'
              ? 'No Mastered Topics Yet'
              : filter === 'remaining'
              ? 'All Topics Mastered!'
              : 'No Topics Found'}
          </h3>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-dim">
            {filter === 'completed'
              ? 'Start learning and taking checkpoint quizzes with your AI tutor to master your first topics!'
              : filter === 'remaining'
              ? 'Congratulations! You have completed all syllabus topics for this subject.'
              : 'No topics matched your search criteria.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {displayedTopics.map((topicItem, index) => {
            const isCompleted = topicItem.isMastered
            return (
              <div
                key={topicItem.normalizedTopic || topicItem.topic || index}
                className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border p-5 transition-all duration-300 ${
                  isCompleted
                    ? 'border-emerald-500/30 bg-gradient-to-b from-emerald-500/5 to-panel hover:border-emerald-500/50 hover:shadow-[0_8px_24px_-10px_rgba(16,185,129,0.25)]'
                    : 'border-line bg-panel hover:border-line-strong hover:bg-hover'
                }`}
              >
                {/* Glow pill for mastered */}
                {isCompleted && (
                  <div className="pointer-events-none absolute -top-8 -right-8 size-24 rounded-full bg-emerald-500/10 blur-xl" />
                )}

                <div>
                  {/* Status row */}
                  <div className="flex items-center justify-between gap-1.5 flex-wrap">
                    {topicItem.needsRefresher ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300 ring-1 ring-amber-500/30">
                        <RefreshCw size={11} className="animate-spin-slow text-amber-400" />
                        <span>Needs Refresher</span>
                      </span>
                    ) : isCompleted ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-400 ring-1 ring-emerald-500/25">
                        <CheckCircle2 size={12} />
                        <span>Mastered</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-raised px-2.5 py-0.5 text-[11px] font-medium text-mute ring-1 ring-line">
                        <Clock size={12} />
                        <span>To Learn</span>
                      </span>
                    )}

                    <div className="flex items-center gap-1.5">
                      {topicItem.effectiveMastery !== undefined && (
                        <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent-strong ring-1 ring-line">
                          {Math.round(topicItem.effectiveMastery * 100)}% BKT
                        </span>
                      )}
                      {isCompleted && topicItem.bestScore !== undefined && (
                        <span className="font-mono text-[11px] font-semibold text-emerald-300">
                          {topicItem.bestScore}/{topicItem.total}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Topic Title */}
                  <h3 className="mt-3 font-display text-base font-semibold leading-snug text-fg group-hover:text-accent-strong">
                    {topicItem.topic}
                  </h3>

                  {/* Diagnosed Misconception Notice */}
                  {topicItem.activeMisconceptions && topicItem.activeMisconceptions.length > 0 && (
                    <div className="mt-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 p-2.5 text-[11.5px]">
                      <span className="font-semibold text-amber-400">Diagnosed Misconception:</span>
                      <p className="mt-1 text-dim italic leading-snug">
                        "{typeof topicItem.activeMisconceptions[0] === 'object' ? topicItem.activeMisconceptions[0].misconception : topicItem.activeMisconceptions[0]}"
                      </p>
                    </div>
                  )}

                  {/* Metadata & Prerequisites */}
                  <div className="mt-2.5 space-y-1.5">
                    {isCompleted && topicItem.firstMasteredAt && (
                      <div className="flex items-center gap-1.5 text-[11.5px] text-mute">
                        <Award size={12} className="text-emerald-400" />
                        <span>Mastered on {formatDate(topicItem.firstMasteredAt)}</span>
                      </div>
                    )}

                    {topicItem.prerequisites && topicItem.prerequisites.length > 0 && (
                      <div className="pt-1">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
                          Prerequisites:
                        </span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {topicItem.prerequisites.map((p, pIdx) => {
                            const pNorm = p.toLowerCase().trim()
                            const isPCompleted = masteryData.masteredTopics.some(
                              (mt) => mt.normalizedTopic === pNorm || mt.topic.toLowerCase() === pNorm
                            )
                            return (
                              <span
                                key={pIdx}
                                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium ${
                                  isPCompleted
                                    ? 'bg-emerald-500/10 text-emerald-300'
                                    : 'bg-raised text-dim'
                                }`}
                              >
                                {isPCompleted ? (
                                  <CheckCircle2 size={10} className="text-emerald-400" />
                                ) : (
                                  <span className="size-1 rounded-full bg-mute" />
                                )}
                                <span>{p}</span>
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Action footer */}
                <div className="mt-5 border-t border-line/60 pt-3">
                  {isCompleted ? (
                    <button
                      type="button"
                      onClick={() =>
                        onStudyTopic(
                          `Can we do a quick review and advanced questions on ${topicItem.topic}?`,
                          currentSubjectObj
                        )
                      }
                      className="group/btn flex w-full items-center justify-between text-xs font-medium text-dim transition hover:text-accent"
                    >
                      <span className="flex items-center gap-1.5">
                        <Sparkles size={13} className="text-emerald-400" />
                        <span>Review & Drill</span>
                      </span>
                      <ArrowUpRight
                        size={13}
                        className="transition group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5"
                      />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        onStudyTopic(
                          `Can you teach me about ${topicItem.topic}? Please explain the core intuition, key properties, and examples.`,
                          currentSubjectObj
                        )
                      }
                      className="press flex w-full items-center justify-center gap-2 rounded-xl bg-accent/15 px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent hover:text-white shadow-xs"
                    >
                      <BookOpen size={13} />
                      <span>Learn with Tutor</span>
                      <ChevronRight size={13} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
