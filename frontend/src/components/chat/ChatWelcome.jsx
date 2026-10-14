import { FolderOpen, RefreshCw } from 'lucide-react'
import SubjectIcon from '../ui/SubjectIcon'

export default function ChatWelcome({ subject, refreshing, questions, onRefresh, onSelect }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl xl:max-w-6xl animate-rise flex-col items-center pt-6 text-center sm:pt-12">
      <div className="grid size-14 place-items-center rounded-2xl bg-linear-to-br from-accent-soft to-panel text-accent ring-1 ring-line-strong">
        <SubjectIcon code={subject.code} size={26} />
      </div>
      <h3 className="mt-6 text-2xl font-bold tracking-tight text-fg sm:text-[2rem]">
        Welcome to <span className="font-serif font-normal italic text-accent">{subject.name}</span> Tutor
      </h3>
      <p className="mt-3 max-w-lg text-[15.5px] leading-relaxed text-dim">
        Ask any question related to {subject.code} course materials.
        I'll explain concepts at your chosen level.
      </p>

      {refreshing || questions.length > 0 ? (
        <div className="mt-10 w-full text-left">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] font-semibold tracking-[0.14em] text-dim uppercase">Sample Questions from Course Materials</span>
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-dim hover:bg-hover hover:text-fg disabled:opacity-60"
            >
              {refreshing ? 'Refreshing...' : <><RefreshCw size={13} /> Refresh Questions</>}
            </button>
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2">
            {refreshing
              ? Array.from({ length: 4 }).map((_, idx) => (
                  <div key={`skel-${idx}`} className="rounded-xl border border-line bg-panel p-4.5">
                    <div className="flex gap-2">
                      <span className="skeleton h-5 w-20 rounded-full" />
                      <span className="skeleton h-5 w-14 rounded-full" />
                    </div>
                    <div className="skeleton mt-3 h-3.5 w-11/12 rounded" />
                    <div className="skeleton mt-2 h-3.5 w-2/3 rounded" />
                  </div>
                ))
              : questions.slice(0, 4).map((sq, idx) => (
                  <button
                    type="button"
                    key={idx}
                    onClick={() => onSelect(sq)}
                    className="group lift press animate-rise relative rounded-2xl border border-line bg-panel p-5 text-left shadow-xs hover:border-accent/40"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-semibold text-accent-strong">{sq.topic}</span>
                      <span className="rounded-full border border-line bg-raised px-2 py-0.5 text-[11px] font-medium text-dim capitalize">{sq.level}</span>
                    </div>
                    <div className="mt-3 text-[14px] font-medium leading-snug text-fg">{sq.question}</div>
                  </button>
                ))}
          </div>
        </div>
      ) : (
        <div className="mt-10 w-full rounded-2xl border border-dashed border-line-strong px-6 py-10">
          <div className="mx-auto grid size-12 place-items-center rounded-xl bg-raised text-mute">
            <FolderOpen size={24} />
          </div>
          <h4 className="mt-4 font-medium text-fg">Sample Questions Not Ready Yet</h4>
          <p className="mx-auto mt-2 max-w-md text-sm text-dim">
            Sample questions for <strong className="text-fg">{subject.name}</strong> could not be loaded right now. You can still ask any course question directly in the chat below, or retry loading questions.
          </p>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20 transition-colors"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Loading Questions...' : 'Load Sample Questions'}
          </button>
        </div>
      )}
    </div>
  )
}
