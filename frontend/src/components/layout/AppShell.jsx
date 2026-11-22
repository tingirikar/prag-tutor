import { useEffect, useRef, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'

export default function AppShell({ sidebar, mobileTitle, children }) {
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem('rail-width')
    return saved ? Math.max(240, Math.min(420, parseInt(saved, 10))) : 280
  })
  const [dragging, setDragging] = useState(false)
  const widthRef = useRef(width)
  widthRef.current = width

  const close = () => setOpen(false)

  // Drag-to-resize sidebar width
  const startResize = (e) => {
    e.preventDefault()
    setDragging(true)
    const startX = e.clientX
    const startW = widthRef.current

    const onPointerMove = (ev) => {
      const nextW = Math.max(240, Math.min(460, startW + (ev.clientX - startX)))
      setWidth(nextW)
      widthRef.current = nextW
    }
    const onPointerUp = () => {
      setDragging(false)
      localStorage.setItem('rail-width', String(widthRef.current))
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  // Close drawer on Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className={`flex h-dvh overflow-hidden bg-ink text-fg ${dragging ? 'cursor-col-resize select-none' : ''} ${collapsed ? 'rail-collapsed' : ''}`} style={{ '--rail-w': `${width}px` }}>
      {/* Mobile scrim */}
      <div
        className={`fixed inset-0 z-40 bg-[#0b0f1e]/45 backdrop-blur-sm transition-opacity lg:hidden ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={close}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[280px] shrink-0 flex-col rail-dark transition-transform duration-300 ease-out lg:visible lg:relative lg:w-[var(--rail-w)] lg:translate-x-0 lg:transition-none ${open ? 'visible translate-x-0' : 'invisible -translate-x-full'} ${collapsed ? 'lg:hidden' : ''}`}
      >
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Hide sidebar"
          title="Hide sidebar"
          className="absolute top-4 right-3 z-10 hidden size-8 place-items-center rounded-lg text-mute hover:bg-hover hover:text-fg lg:grid"
        >
          <PanelLeftClose size={17} />
        </button>
        {/* Drag handle */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={startResize}
          onDoubleClick={() => { widthRef.current = 280; setWidth(280); localStorage.setItem('rail-width', '280') }}
          className={`absolute inset-y-0 -right-1.5 z-10 hidden w-3 cursor-col-resize lg:block after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:transition-colors hover:after:bg-accent/50 ${dragging ? 'after:bg-accent' : ''}`}
        />
        <button
          type="button"
          onClick={close}
          aria-label="Close menu"
          className="absolute top-4 right-3 z-10 grid size-8 place-items-center rounded-lg text-dim hover:bg-hover hover:text-fg lg:hidden"
        >
          <X size={18} />
        </button>
        <div className="pointer-events-none absolute inset-0 overflow-hidden"><div className="rail-aurora" /></div>
        <div className="relative flex min-h-0 flex-1 flex-col">{sidebar(close)}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-rail/80 px-3 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="grid size-9 place-items-center rounded-lg text-dim hover:bg-hover hover:text-fg"
          >
            <PanelLeftOpen size={18} />
          </button>
          <div className="truncate text-sm font-medium text-fg">{mobileTitle}</div>
        </header>

        <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {collapsed && (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              aria-label="Show sidebar"
              title="Show sidebar"
              className="absolute top-3.5 left-3 z-20 hidden size-9 place-items-center rounded-xl border border-line bg-panel text-dim shadow-sm transition hover:border-accent hover:text-fg lg:grid"
            >
              <PanelLeftOpen size={18} />
            </button>
          )}
          {children}
        </main>
      </div>
    </div>
  )
}
