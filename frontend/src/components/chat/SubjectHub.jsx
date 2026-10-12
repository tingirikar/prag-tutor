import { ArrowRight, Cpu, Database, GraduationCap, User, Zap } from 'lucide-react'
import SubjectIcon from '../ui/SubjectIcon'

const features = [
  [Zap, 'Retrieval Augmented Generation', 'Fact-checked against verified course texts without hallucinating.'],
  [Database, 'Persistent Saved Chats', 'Every session is stored in MongoDB so you can resume anytime.'],
  [Cpu, 'Local & Cloud Models', 'Choose ultra-fast Groq cloud LLMs or offline local Ollama models.'],
]

export default function SubjectHub({ user, subjects, onSelect }) {
  const visibleSubjects = (user?.enrolled && Array.isArray(user.enrolled) && user.enrolled.length > 0)
    ? subjects.filter((subj) => user.enrolled.includes(subj.code))
    : subjects
  
  return (
    <div className="grain h-full overflow-y-auto scroll-thin">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 lg:py-16">
        <div className="animate-rise">
          <div className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-panel px-3 py-1 text-[12px] text-dim">
            <GraduationCap size={14} className="text-accent" /> Student Dashboard
          </div>
          <h1 className="mt-5 text-[clamp(2rem,4.2vw,3.25rem)] leading-[1.05] font-semibold tracking-[-0.03em] text-fg">
            Welcome back, <span className="font-serif font-normal italic text-accent">{user.name || 'Student'}</span>
          </h1>
          <p className="mt-4 max-w-xl text-[15px] text-dim">
            Select your course subject below to start personalized AI tutoring grounded in your syllabus.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleSubjects.map((subj, i) => (
            <div
              key={subj.code}
              onClick={() => onSelect(subj)}
              style={{ animationDelay: `${i * 60}ms` }}
              className="group relative flex animate-rise cursor-pointer flex-col overflow-hidden rounded-2xl border border-line bg-panel p-6 transition-all duration-300 hover:-translate-y-1 hover:border-line-strong hover:shadow-[0_30px_60px_-30px_#3247d666] sheen press"
              onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`); e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`) }}
            >
              <div className="pointer-events-none absolute -top-24 -right-24 size-56 rounded-full bg-accent/0 blur-3xl transition group-hover:bg-accent/15" />
              <div className="flex items-start justify-between">
                <span className="grid size-12 place-items-center rounded-xl bg-gradient-to-br from-accent-soft to-raised text-accent ring-1 ring-line-strong">
                  <SubjectIcon code={subj.code} size={24} />
                </span>
                <span className="rounded-md border border-line-strong px-2 py-0.5 font-mono text-[11px] tracking-wider text-dim">{subj.code}</span>
              </div>
              <h3 className="mt-6 text-lg font-semibold tracking-tight text-fg">{subj.name}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-dim">{subj.description}</p>
              <div className="mt-5 flex items-center gap-2 border-t border-line pt-4 text-[13px] text-mute">
                <User size={14} /> Faculty: <strong className="truncate font-medium text-dim">{subj.teacherName || subj.teacherUsername}</strong>
              </div>
              <button
                type="button"
                className="mt-4 flex h-10 items-center justify-between rounded-xl bg-raised px-4 text-sm font-medium text-fg transition group-hover:bg-accent group-hover:text-white"
              >
                Launch {subj.code} Tutor <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-12 grid overflow-hidden rounded-2xl border border-line md:grid-cols-3">
          {features.map(([Ico, title, body], i) => (
            <div key={title} className={`flex gap-4 bg-rail/60 p-6 ${i > 0 ? 'border-t border-line md:border-t-0 md:border-l' : ''}`}>
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                <Ico size={19} />
              </span>
              <div>
                <strong className="block text-sm font-medium text-fg">{title}</strong>
                <p className="mt-1 text-[13px] leading-relaxed text-mute">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
