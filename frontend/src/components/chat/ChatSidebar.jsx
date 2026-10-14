import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, MessageSquare, SquarePen, Trash2, GraduationCap } from 'lucide-react'
import SubjectIcon from '../ui/SubjectIcon'
import UserFooter from '../layout/UserFooter'

export default function ChatSidebar({
  subject, conversations, currentConversationId, deletingConvId,
  onBack, onNewChat, onLoad, onAskDelete, onConfirmDelete, onCancelDelete,
  user, onLogout, close,
  activeView = 'chat', onViewChange,
}) {
  const [anchor, setAnchor] = useState(null)
  const target = conversations.find(c => c._id === deletingConvId)

  // ⌘K / Ctrl+K starts a new chat
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); onNewChat() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onNewChat])

  return (
    <>
      <div className="space-y-3 p-3 pt-4">
        <button
          type="button"
          onClick={() => { onBack(); close() }}
          className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium text-mute transition-colors hover:text-fg"
        >
          <ArrowLeft size={15} className="transition-transform duration-300 group-hover:-translate-x-1" />
          <span>All Subjects</span>
        </button>

        <div className="relative animate-rise overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-panel to-raised p-4">
          <div className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-accent/25 blur-2xl" />
          <div className="relative flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent-strong ring-1 ring-accent/25">
              <SubjectIcon code={subject.code} size={19} />
            </span>
            <div className="min-w-0">
              <strong className="block font-mono text-[11px] font-semibold tracking-[0.18em] text-accent">{subject.code}</strong>
              <small className="block truncate font-display text-[15px] text-fg">{subject.name}</small>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => { onNewChat(); onViewChange?.('chat'); close() }}
          className="press group flex w-full items-center gap-2.5 rounded-xl bg-accent px-3.5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_28px_-12px_#7b93ff] transition-all hover:brightness-110"
        >
          <SquarePen size={16} className="transition-transform duration-300 group-hover:-rotate-12" />
          <span>New Chat</span>
          <kbd className="ml-auto rounded-md bg-white/15 px-1.5 py-0.5 font-mono text-[10px] text-white/80">⌘K</kbd>
        </button>

        <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-panel p-1">
          <button
            type="button"
            onClick={() => { onViewChange?.('chat'); close() }}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition ${
              activeView === 'chat'
                ? 'bg-accent-soft text-accent font-semibold shadow-2xs'
                : 'text-dim hover:text-fg'
            }`}
          >
            <MessageSquare size={13} />
            <span>Chat</span>
          </button>
          <button
            type="button"
            onClick={() => { onViewChange?.('mastery'); close() }}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition ${
              activeView === 'mastery'
                ? 'bg-accent-soft text-accent font-semibold shadow-2xs'
                : 'text-dim hover:text-fg'
            }`}
          >
            <GraduationCap size={13} />
            <span>Mastery</span>
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 scroll-thin">
        <div className="flex items-center justify-between px-2 pt-4 pb-2">
          <span className="font-mono text-[10px] font-semibold tracking-[0.18em] text-mute uppercase">Saved Conversations</span>
          {conversations.length > 0 && <span className="rounded-full bg-raised px-1.5 font-mono text-[10px] text-dim">{conversations.length}</span>}
        </div>
        {conversations.length === 0 ? (
          <div className="mx-1 rounded-xl border border-dashed border-line-strong px-3 py-4 text-[13px] leading-relaxed text-mute">No saved chats in {subject.code} yet. Start asking a question!</div>
        ) : (
          <div className="space-y-0.5">
            {conversations.map((conv, i) => {
              const active = currentConversationId === conv._id
              const confirming = deletingConvId === conv._id
              return (
                <div
                  key={conv._id}
                  onClick={() => {
                    if (confirming) return
                    onLoad(conv._id)
                    close()
                  }}
                  style={{ animationDelay: `${i * 40}ms` }}
                  className={`group relative flex h-10 animate-slide-in cursor-pointer items-center gap-2.5 rounded-xl px-3 text-[13.5px] transition-all duration-300 ${
                    confirming ? 'bg-hover text-fg' : active ? 'bg-accent-soft font-medium text-fg' : 'text-dim hover:translate-x-0.5 hover:bg-hover hover:text-fg'
                  }`}
                >
                  {active && <span className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-accent shadow-[0_0_10px_#7b93ff]" />}
                  <MessageSquare size={14} className={`shrink-0 ${active ? 'text-accent' : 'text-mute'}`} />
                  <span className="min-w-0 flex-1 truncate" title={conv.title}>{conv.title}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setAnchor(e.currentTarget.getBoundingClientRect())
                      onAskDelete(conv._id)
                    }}
                    title="Delete Chat"
                    className={`grid size-6 shrink-0 place-items-center rounded-md transition hover:bg-danger/20 hover:text-[#ff8a80] ${
                      confirming ? 'bg-danger/20 text-[#ff8a80] opacity-100' : 'text-mute opacity-100 lg:opacity-0 lg:group-hover:opacity-100'
                    }`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {target && anchor && (
        <DeletePopover
          anchor={anchor}
          title={target.title}
          onConfirm={(e) => onConfirmDelete(target._id, e)}
          onCancel={() => onCancelDelete({ stopPropagation() {} })}
        />
      )}

      <UserFooter
        initial={user.name?.charAt(0) || 'S'}
        name={user.name || 'Student'}
        role="Student"
        logoutLabel="Sign Out"
        onLogout={onLogout}
      />
    </>
  )
}

/** Floating confirm card anchored to the right of the trash button. */
function DeletePopover({ anchor, title, onConfirm, onCancel }) {
  const ref = useRef(null)
  const W = 260
  const left = Math.min(anchor.right + 10, window.innerWidth - W - 12)
  const top = Math.min(Math.max(12, anchor.top - 12), window.innerHeight - 170)

  useEffect(() => {
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && onCancel()
    const onKey = (e) => e.key === 'Escape' && onCancel()
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onCancel)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onCancel)
    }
  }, [onCancel])

  return createPortal(
    <div
      ref={ref}
      role="alertdialog"
      aria-label="Delete chat"
      style={{ left, top, width: W }}
      className="fixed z-[120] animate-pop rounded-2xl border border-line bg-panel p-4 shadow-[0_24px_60px_-16px_#1a24504d]"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-danger/10 text-danger">
          <Trash2 size={15} />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-fg">Delete chat?</p>
          <p className="mt-0.5 truncate text-[12.5px] text-mute" title={title}>“{title}”</p>
        </div>
      </div>
      <p className="mt-3 text-[12.5px] leading-relaxed text-dim">This conversation will be permanently removed.</p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-8 rounded-lg border border-line-strong px-3 text-[13px] font-medium text-dim hover:bg-hover hover:text-fg">
          Cancel
        </button>
        <button type="button" onClick={onConfirm} className="h-8 rounded-lg bg-danger px-3 text-[13px] font-medium text-white hover:brightness-110">
          Delete
        </button>
      </div>
    </div>,
    document.body
  )
}
