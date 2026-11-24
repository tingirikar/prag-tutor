import { useEffect, useRef } from 'react'
import { ArrowUp, Cpu, Gauge, Shapes } from 'lucide-react'
import DropupSelect from './DropupSelect'

export default function Composer({
  input, setInput, onSubmit, loading, placeholder,
  level, levelLabel, levelOptions, onLevelChange,
  modelValue, modelLabel, modelOptions, onModelChange,
  showCustomModel, customModelInput, setCustomModelInput,
  imageMode, diagramLabel, diagramOptions, onDiagramChange,
}) {
  const ref = useRef(null)

  // Auto-grow textarea
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [input])

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-[24px] border border-line-strong bg-panel shadow-[0_1px_0_#fff_inset,0_24px_60px_-30px_#13172659] transition-[border-color,box-shadow] duration-200 focus-within:border-accent/45 focus-within:shadow-[0_0_0_5px_#3247d612,0_30px_70px_-30px_#13172666]"
    >
      <textarea
        ref={ref}
        id="chat-composer"
        rows={1}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
            e.preventDefault()
            if (!loading) onSubmit(e)
          }
        }}
        placeholder={placeholder}
        aria-label="Message the tutor"
        className="scroll-none block max-h-[200px] w-full resize-none bg-transparent px-4 pt-4 pb-2 text-[15px] leading-relaxed text-fg placeholder:text-mute focus:outline-none disabled:opacity-60 sm:px-5"
      />

      <div className="flex items-end gap-2 px-2 pb-2 sm:px-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
          <DropupSelect
            value={level}
            label={levelLabel}
            icon={<Gauge size={13} />}
            options={levelOptions}
            onChange={onLevelChange}
            disabled={loading}
            ariaLabel="Level selection"
            minWidth={150}
          />
          <DropupSelect
            value={modelValue}
            label={modelLabel}
            icon={<Cpu size={13} />}
            options={modelOptions}
            onChange={onModelChange}
            disabled={loading}
            ariaLabel="Model selection"
            minWidth={260}
          />
          {showCustomModel && (
            <input
              type="text"
              placeholder="e.g. mistral, deepseek-r1:7b"
              value={customModelInput}
              onChange={(e) => setCustomModelInput(e.target.value)}
              disabled={loading}
              title="Enter any model name installed in your local Ollama"
              className="h-8 w-44 rounded-lg border border-line-strong bg-ink px-2.5 font-mono text-[12px] text-fg placeholder:text-mute focus:border-accent focus:outline-none"
            />
          )}
          <DropupSelect
            value={imageMode}
            label={diagramLabel}
            icon={<Shapes size={13} />}
            options={diagramOptions}
            onChange={onDiagramChange}
            disabled={loading}
            ariaLabel="Diagrams mode"
            minWidth={230}
          />
        </div>

        <button
          type="submit"
          disabled={loading || !input.trim()}
          aria-label="Send"
          title="Send"
          className="grid size-9 shrink-0 place-items-center rounded-full press bg-fg text-white transition-all duration-300 hover:scale-105 hover:bg-accent hover:shadow-[0_8px_20px_-6px_#3247d6] disabled:scale-100 disabled:bg-raised disabled:text-mute disabled:shadow-none"
        >
          <ArrowUp size={18} strokeWidth={2.4} />
        </button>
      </div>
    </form>
  )
}
