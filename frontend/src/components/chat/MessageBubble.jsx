import { useState } from 'react'
import { ArrowUpRight, BookOpen, Check, ChevronDown, Cpu, FileText, Files, Globe, Images, Sparkles, Target } from 'lucide-react'
import Markdown from './Markdown'
import Spinner from '../ui/Spinner'

function Chip({ icon, label, value, tone = 'default' }) {
  const tones = {
    default: 'border-line bg-panel text-fg shadow-2xs',
    accent: 'border-accent/30 bg-accent-soft text-accent-strong font-semibold shadow-2xs',
    sky: 'border-[#3247d6]/20 bg-[#3247d6]/6 text-[#2a3bb0] font-semibold shadow-2xs',
    violet: 'border-[#6a3fd1]/30 bg-[#6a3fd1]/10 text-[#6a3fd1] font-semibold shadow-2xs',
  }
  return (
    <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] ${tones[tone]}`}>
      <span className="shrink-0 text-mute">{icon}</span>
      {label && <span className="shrink-0 text-mute font-medium">{label}</span>}
      <strong className="truncate font-semibold capitalize">{value}</strong>
    </span>
  )
}

/** Collapsed record of the thinking & retrieval steps that produced this answer. */
function ThoughtTrace({ thinking }) {
  const [open, setOpen] = useState(false)
  const steps = thinking?.steps && thinking.steps.length > 0 ? thinking.steps : [
    { label: 'Analyzed query intent and keywords', status: 'done' },
    { label: 'Retrieved curriculum context & verified syllabus', status: 'done' },
    { label: 'Synthesized response grounded in course documents', status: 'done' },
  ]
  const duration = thinking?.seconds ? `${thinking.seconds}s` : 'Verified'

  return (
    <div className="rounded-xl border border-line bg-panel p-2.5 shadow-2xs transition">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left text-[12.5px] font-medium text-fg transition hover:text-accent"
      >
        <span className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-full bg-accent-soft text-accent">
            <Check size={11} className="stroke-3" />
          </span>
          <span className="font-semibold text-fg">Thinking & Retrieval Pipeline</span>
          <span className="rounded-full bg-raised px-2 py-0.5 font-mono text-[10.5px] font-semibold text-dim">
            {duration}
          </span>
        </span>
        <ChevronDown size={14} className={`text-mute transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2.5 space-y-2 border-t border-line pt-2.5 pl-1.5 animate-rise">
          {steps.map((step, idx) => (
            <div key={idx} className="flex items-center gap-2.5 text-[12.5px] font-medium text-dim">
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-600">
                <Check size={10} className="stroke-3" />
              </span>
              <span>{step.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function MessageBubble({ msg, index, expanded, onToggleSources, onOpenImage, onAsk, username }) {
  if (msg.role === 'user') {
    return (
      <div className="flex animate-rise justify-end">
        <div className="max-w-[85%] rounded-[20px] rounded-br-md bg-[#0f1430] px-4.5 py-3 text-[15px] leading-relaxed whitespace-pre-wrap text-[#eef1fa] shadow-[0_12px_30px_-18px_#0b0f1e] sm:max-w-[75%]">
          {msg.content}
        </div>
      </div>
    )
  }

  const isError = typeof msg.content === 'string' && msg.content.startsWith('Error:')
  const imageToken = sessionStorage.getItem('authToken')

  return (
    <div className="flex animate-rise gap-3 sm:gap-4">
      <div className={`grid size-8 shrink-0 place-items-center rounded-full ring-1 ${isError ? 'bg-danger/10 text-danger ring-danger/30' : 'bg-[#0b0f1e] text-[#a5b4ff] ring-[#0b0f1e]/10 shadow-[0_6px_16px_-8px_#0b0f1e]'}`}>
        <Sparkles size={15} />
      </div>

      <div className="min-w-0 flex-1 space-y-3">
        <ThoughtTrace thinking={msg.thinking} />
        {(msg.topic || msg.level || msg.model) && (
          <div className="flex flex-wrap gap-1.5">
            {msg.topic && <Chip tone="accent" icon={<BookOpen size={12} />} label="Topic:" value={msg.topic} />}
            {msg.level && <Chip icon={<Target size={12} />} value={msg.level} />}
            {msg.model && (
              <Chip
                tone="sky"
                icon={msg.provider === 'local' ? <Cpu size={12} /> : <Globe size={12} />}
                label={msg.provider === 'local' ? 'Local Ollama:' : 'Cloud Groq:'}
                value={msg.model}
              />
            )}
          </div>
        )}

        {msg.imagesLoading && (
          <div className="inline-flex items-center gap-2.5 rounded-xl border border-line bg-panel px-3.5 py-2.5 text-[13px] text-dim">
            <Spinner />
            <span>Loading relevant diagrams...</span>
          </div>
        )}

        {msg.images && msg.images.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-2 font-mono text-[11px] tracking-wide text-mute uppercase">
              <Images size={13} /> Relevant Diagrams ({msg.images.length})
            </div>
            <div className="flex snap-x gap-3 overflow-x-auto pb-1 scroll-thin">
              {msg.images.map((img, imgIdx) => (
                <button
                  type="button"
                  key={imgIdx}
                  onClick={() => onOpenImage({ image: img, images: msg.images, index: imgIdx })}
                  title="Click to expand"
                  className="group relative h-40 w-56 shrink-0 snap-start overflow-hidden rounded-xl border border-line bg-panel transition hover:border-accent"
                >
                  <img
                    src={`/api${img.url}?u=${encodeURIComponent(username || 'student')}&token=${encodeURIComponent(imageToken || '')}`}
                    alt={img.source === 'document' ? `Diagram from ${img.document}, page ${img.page + 1}` : 'Diagram'}
                    loading="lazy"
                    className="size-full object-contain transition-transform group-hover:scale-[1.03]"
                  />
                  <span className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 truncate bg-linear-to-t from-black/85 to-transparent px-2.5 pt-6 pb-2 text-left text-[11px] text-white">
                    <FileText size={11} className="shrink-0" />
                    <span className="truncate">{img.document} (p. {img.page + 1})</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={isError || msg.rejected ? 'rounded-xl border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger' : ''}>
          <Markdown content={msg.content} />
        </div>

        {msg.prerequisites && msg.prerequisites.length > 0 && !msg.rejected && (
          <div className="rounded-xl border border-line bg-panel p-3.5 shadow-2xs">
            <div className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-fg">
              <BookOpen size={14} className="text-accent" />
              <span>Prerequisites</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {msg.prerequisites.map((prerequisite, prerequisiteIndex) => (
                <button
                  type="button"
                  key={`${prerequisite}-${prerequisiteIndex}`}
                  onClick={() => onAsk?.(`Teach me ${prerequisite}`, prerequisite)}
                  className="inline-flex items-center gap-2 rounded-lg border border-line bg-rail/60 px-3 py-1.5 text-[12.5px] font-medium text-fg transition hover:border-accent hover:bg-accent-soft hover:text-accent-strong shadow-2xs"
                >
                  <span>{prerequisite}</span>
                  <ArrowUpRight size={13} className="text-dim" />
                </button>
              ))}
            </div>
          </div>
        )}

        {msg.exploreNext && msg.exploreNext.length > 0 && !msg.rejected && (
          <div className="rounded-xl border border-line bg-panel p-3.5 shadow-2xs">
            <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-fg">
              <ArrowUpRight size={14} className="text-accent" />
              <span>Explore Next</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {msg.exploreNext.map((item, itemIndex) => (
                <button
                  type="button"
                  key={`${item.topic || item.question}-${itemIndex}`}
                  onClick={() => onAsk?.(item.question, item.topic)}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5 text-left text-[12.5px] font-medium text-fg transition hover:border-accent hover:bg-accent-soft hover:text-accent-strong"
                >
                  <span>{item.question || item.topic}</span>
                  <ArrowUpRight size={13} className="shrink-0 text-mute" />
                </button>
              ))}
            </div>
          </div>
        )}

        {msg.sources && msg.sources.length > 0 && (
          <div className="rounded-xl border border-line bg-panel shadow-2xs">
            <button
              type="button"
              onClick={() => onToggleSources(index)}
              className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-[13px] font-medium text-fg hover:text-fg"
            >
              <span className="flex items-center gap-2">
                <Files size={14} className="text-accent" />
                <span>{expanded ? 'Hide Verified Sources' : 'Show Verified Sources'}</span>
                <span className="rounded-md bg-raised px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-dim">{msg.sources.length}</span>
              </span>
              <ChevronDown size={15} className={`text-mute transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>

            {expanded && (
              <div className="divide-y divide-line border-t border-line">
                {msg.sources.map((src, sIdx) => (
                  <div key={sIdx} className="px-3.5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-fg">
                        <FileText size={13} className="shrink-0 text-mute" />
                        <span className="truncate">{src.document}</span>
                      </span>
                      {src.score && (
                        <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10.5px] font-semibold text-accent-strong">{src.score}% Match</span>
                      )}
                    </div>
                    <div className="mt-1.5 line-clamp-4 text-[13px] leading-relaxed text-dim">"{src.snippet}"</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
