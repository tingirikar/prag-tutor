import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, Files, GitFork } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import NavItem from '../components/layout/NavItem'
import UserFooter from '../components/layout/UserFooter'
import Brand from '../components/ui/Brand'
import UploadPanel from '../components/teacher/UploadPanel'
import DocumentsPanel from '../components/teacher/DocumentsPanel'
import PrerequisitesPanel from '../components/teacher/PrerequisitesPanel'
import TopicCard from '../components/teacher/TopicCard'
import AddTopicModal from '../components/teacher/AddTopicModal'
import { apiFetch } from '../api'

const sanitizeFileName = (fileName) => {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export default function TeacherDashboard() {
  const navigate = useNavigate()
  const fileInputRef = useRef(null)

  const [currentUser, setCurrentUser] = useState(() => JSON.parse(sessionStorage.getItem('user') || '{}'))
  const teacherSubject = (currentUser.subject || (currentUser.username?.startsWith('teacher_') ? currentUser.username.replace('teacher_', '') : currentUser.username) || '').toUpperCase()

  // Auth guard
  useEffect(() => {
    const user = JSON.parse(sessionStorage.getItem('user') || '{}')
    if (user.role !== 'teacher') {
      navigate('/', { replace: true })
    } else {
      setCurrentUser(user)
    }
  }, [navigate])

  const [files, setFiles] = useState([])          // staged files
  const [documents, setDocuments] = useState([])   // "uploaded" documents
  const [prerequisites, setPrerequisites] = useState({}) // subject prerequisites
  const [loadingPrereqs, setLoadingPrereqs] = useState(false)
  const [prereqSearch, setPrereqSearch] = useState('')
  const [activeTab, setActiveTab] = useState('upload')
  const [dragOver, setDragOver] = useState(false)
  const [deletingDocName, setDeletingDocName] = useState(null)

  // Prerequisite CRUD State
  const [showAddModal, setShowAddModal] = useState(false)
  const [newTopicName, setNewTopicName] = useState('')
  const [newTopicPrereqs, setNewTopicPrereqs] = useState([])
  const [newPrereqInput, setNewPrereqInput] = useState('')
  const [isSubmittingTopic, setIsSubmittingTopic] = useState(false)

  // Card Editing State
  const [editingTopic, setEditingTopic] = useState(null)
  const [editPrereqsList, setEditPrereqsList] = useState([])
  const [editNewChipInput, setEditNewChipInput] = useState('')
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [isDeletingTopic, setIsDeletingTopic] = useState(false)

  const handleAddTopic = async (e) => {
    if (e) e.preventDefault()
    const trimmed = newTopicName.trim()
    if (!trimmed) {
      alert('Please enter a topic name.')
      return
    }
    setIsSubmittingTopic(true)
    try {
      const res = await apiFetch('/api/prerequisites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: teacherSubject,
          topic: trimmed,
          prerequisites: newTopicPrereqs,
          createdBy: currentUser.username || 'teacher'
        })
      })
      if (res.ok) {
        setNewTopicName('')
        setNewTopicPrereqs([])
        setNewPrereqInput('')
        setShowAddModal(false)
        await fetchPrerequisites()
      } else {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to add topic')
      }
    } catch (err) {
      console.error('Add topic error:', err)
      alert('Error adding topic')
    } finally {
      setIsSubmittingTopic(false)
    }
  }

  const handleAddChipToNewTopic = () => {
    const trimmed = newPrereqInput.trim()
    if (trimmed && !newTopicPrereqs.includes(trimmed)) {
      setNewTopicPrereqs(prev => [...prev, trimmed])
      setNewPrereqInput('')
    }
  }

  const handleRemoveChipFromNewTopic = (index) => {
    setNewTopicPrereqs(prev => prev.filter((_, i) => i !== index))
  }

  const handleStartEdit = (topic, currentPrereqs) => {
    setEditingTopic(topic)
    setEditPrereqsList([...(currentPrereqs || [])])
    setEditNewChipInput('')
  }

  const handleCancelEdit = () => {
    setEditingTopic(null)
    setEditPrereqsList([])
    setEditNewChipInput('')
  }

  const handleRemoveChipFromEdit = (index) => {
    setEditPrereqsList(prev => prev.filter((_, i) => i !== index))
  }

  const handleAddChipToEdit = () => {
    const trimmed = editNewChipInput.trim()
    if (trimmed && !editPrereqsList.includes(trimmed)) {
      setEditPrereqsList(prev => [...prev, trimmed])
      setEditNewChipInput('')
    }
  }

  const handleSaveEdit = async (topic) => {
    setIsSavingEdit(true)
    try {
      const res = await apiFetch('/api/prerequisites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: teacherSubject,
          topic,
          prerequisites: editPrereqsList
        })
      })
      if (res.ok) {
        setEditingTopic(null)
        await fetchPrerequisites()
      } else {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to update prerequisites')
      }
    } catch (err) {
      console.error('Update prerequisites error:', err)
      alert('Error updating prerequisites')
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleDeleteTopic = async (topic) => {
    if (!window.confirm(`Are you sure you want to permanently delete "${topic}" from the ${teacherSubject} syllabus?`)) {
      return
    }
    setIsDeletingTopic(true)
    try {
      const res = await apiFetch('/api/prerequisites', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: teacherSubject,
          topic
        })
      })
      if (res.ok) {
        if (editingTopic === topic) setEditingTopic(null)
        await fetchPrerequisites()
      } else {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to delete topic')
      }
    } catch (err) {
      console.error('Delete topic error:', err)
      alert('Error deleting topic')
    } finally {
      setIsDeletingTopic(false)
    }
  }

  const handleFiles = (fileList) => {
    const pdfs = Array.from(fileList).filter(f => f.type === 'application/pdf')
    if (pdfs.length === 0) return
    
    // Check for duplicates with existing staged files
    const existingFileNames = new Set(files.map(f => sanitizeFileName(f.name)))
    // Check for duplicates with already uploaded documents
    const uploadedFileNames = new Set(documents.map(d => d.name))
    
    const validFiles = []
    const duplicateFiles = []
    
    pdfs.forEach(f => {
      const sanitizedName = sanitizeFileName(f.name)
      if (existingFileNames.has(sanitizedName) || uploadedFileNames.has(sanitizedName)) {
        duplicateFiles.push(f.name)
      } else {
        validFiles.push(f)
      }
    })
    
    if (duplicateFiles.length > 0) {
      alert(`The following files already exist and were skipped:\n${duplicateFiles.join('\n')}`)
    }
    
    if (validFiles.length === 0) return
    
    const newFiles = validFiles.map(f => ({
      id: crypto.randomUUID(),
      file: f,
      name: f.name,
      size: f.size,
      status: 'pending',   // pending | uploading | done | error
      progress: 0,
      stage: 'Ready to upload',
    }))
    setFiles(prev => [...prev, ...newFiles])
  }

  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  const fetchDocuments = async () => {
    try {
      const res = await apiFetch(`/api/documents?subject=${encodeURIComponent(teacherSubject)}`)
      if (res.ok) {
        const data = await res.json()
        setDocuments(data.documents || [])
      }
    } catch (err) {
      console.error('Failed to fetch documents:', err)
    }
  }

  const fetchPrerequisites = async () => {
    setLoadingPrereqs(true)
    try {
      const res = await apiFetch(`/api/prerequisites?subject=${encodeURIComponent(teacherSubject)}`)
      if (res.ok) {
        const data = await res.json()
        setPrerequisites(data.prerequisites || {})
      }
    } catch (err) {
      console.error('Failed to fetch prerequisites:', err)
    } finally {
      setLoadingPrereqs(false)
    }
  }

  const executeDeleteDocument = async (name) => {
    try {
      const res = await apiFetch('/api/documents/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: sanitizeFileName(name), subject: teacherSubject }),
      })
      setDeletingDocName(null)
      if (res.ok) {
        fetchDocuments()
        fetchPrerequisites()
      } else {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to delete document')
      }
    } catch (err) {
      console.error('Delete error:', err)
      setDeletingDocName(null)
      alert('Error deleting document')
    }
  }

  useEffect(() => {
    fetchDocuments()
    fetchPrerequisites()
  }, [activeTab, teacherSubject])

  const uploadSingleFile = (fileObj) => {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest()
      const formData = new FormData()
      formData.append('subject', teacherSubject)
      formData.append('file', fileObj.file)

      setFiles(prev => prev.map(x => x.id === fileObj.id ? {
        ...x,
        status: 'uploading',
        progress: 2,
        stage: 'Transferring PDF to server...'
      } : x))

      // 1. Monitor network byte transfer (0% - 20% total pipeline)
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          const bytePct = Math.round((event.loaded / event.total) * 100)
          const scaledPct = Math.min(20, Math.max(2, Math.round(bytePct * 0.2)))
          setFiles(prev => prev.map(x => x.id === fileObj.id ? {
            ...x,
            status: 'uploading',
            progress: scaledPct,
            stage: `Uploading bytes (${bytePct}%)...`
          } : x))
        }
      }

      // 2. Stream real AI pipeline progress from Express SSE response (20% - 100%)
      let seenIndex = 0
      let streamError = ''
      xhr.onprogress = () => {
        const fullText = xhr.responseText
        const chunk = fullText.slice(seenIndex)
        const lastNewline = chunk.lastIndexOf('\n')
        if (lastNewline === -1) return
        const processable = chunk.slice(0, lastNewline)
        seenIndex += lastNewline + 1

        const lines = processable.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6))
              if (data.error) {
                streamError = data.error
                setFiles(prev => prev.map(x => x.id === fileObj.id ? {
                  ...x,
                  status: 'error',
                  progress: 0,
                  stage: data.error
                } : x))
              } else if (data.percent !== undefined) {
                const overallPct = Math.min(100, Math.max(20, Math.round(20 + (data.percent * 0.8))))
                const isFinished = data.done || overallPct >= 100
                setFiles(prev => prev.map(x => x.id === fileObj.id ? {
                  ...x,
                  status: isFinished ? 'done' : 'uploading',
                  progress: isFinished ? 100 : overallPct,
                  stage: data.stage || 'Processing document...'
                } : x))
              }
            } catch {
              // Ignore partial chunk boundaries
            }
          }
        }
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300 && !streamError) {
          setFiles(prev => prev.map(x => x.id === fileObj.id ? {
            ...x,
            status: 'done',
            progress: 100,
            stage: 'Completed & Indexed'
          } : x))
          fetchDocuments()
          fetchPrerequisites()
          resolve(true)
        } else {
          let errorMsg = streamError || `Server error (${xhr.status})`
          try {
            const errObj = JSON.parse(xhr.responseText)
            if (errObj.error) errorMsg = errObj.error
          } catch {}
          setFiles(prev => prev.map(x => x.id === fileObj.id ? {
            ...x,
            status: 'error',
            stage: errorMsg
          } : x))
          resolve(false)
        }
      }

      xhr.onerror = () => {
        setFiles(prev => prev.map(x => x.id === fileObj.id ? {
          ...x,
          status: 'error',
          stage: 'Network transfer failed'
        } : x))
        resolve(false)
      }

      xhr.open('POST', `/api/upload?stream=true&subject=${encodeURIComponent(teacherSubject)}`, true)
      xhr.setRequestHeader('Accept', 'text/event-stream')
      const authToken = sessionStorage.getItem('authToken')
      if (authToken) xhr.setRequestHeader('Authorization', `Bearer ${authToken}`)
      xhr.send(formData)
    })
  }

  const uploadAll = async () => {
    const pendingFiles = files.filter(f => f.status === 'pending')
    if (pendingFiles.length === 0 || files.some(f => f.status === 'uploading')) return

    for (const f of pendingFiles) {
      await uploadSingleFile(f)
    }
  }

  const clearDone = () => {
    setFiles(prev => prev.filter(f => f.status !== 'done'))
  }

  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / 1048576).toFixed(1) + ' MB'
  }

  const logout = () => {
    sessionStorage.removeItem('user')
    sessionStorage.removeItem('authToken')
    navigate('/')
  }

  const goPrereqs = () => {
    setActiveTab('prerequisites')
    fetchPrerequisites()
  }

  const navItems = [
    ['upload', 'Upload', <Upload size={17} />, () => setActiveTab('upload')],
    ['documents', 'Documents', <Files size={17} />, () => setActiveTab('documents')],
    ['prerequisites', 'Prerequisites', <GitFork size={17} />, goPrereqs],
  ]

  return (
    <AppShell
      sidebar={(close) => (
        <>
          <div className="p-4 pt-5"><Brand /></div>
          <div className="mx-3 mt-3 animate-rise overflow-hidden rounded-2xl border border-line bg-panel/70 p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] tracking-[0.18em] text-mute uppercase">Workspace</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10.5px] font-medium text-emerald-300">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> Live
              </span>
            </div>
            <div className="mt-2 font-display text-[22px] leading-none text-fg italic">{teacherSubject}</div>
            <div className="mt-1 text-[12.5px] text-dim">Faculty workspace</div>
          </div>
          <div className="px-5 pt-6 pb-2 font-mono text-[10px] tracking-[0.18em] text-mute uppercase">Manage</div>
          <nav className="flex-1 space-y-1 px-3">
            {navItems.map(([key, label, icon, onClick], i) => (
              <NavItem key={key} index={i} active={activeTab === key} icon={icon} label={label} onClick={() => { onClick(); close() }} />
            ))}
          </nav>
          <UserFooter
            initial={currentUser.name?.charAt(0) || 'T'}
            name={currentUser.name || 'Teacher'}
            role={`${teacherSubject} Faculty`}
            logoutLabel="Logout"
            onLogout={logout}
          />
        </>
      )}
    >
      <div className="grain h-full overflow-y-auto scroll-thin">
        <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:py-12">
          {activeTab === 'upload' && (
            <UploadPanel
              subject={teacherSubject}
              files={files}
              dragOver={dragOver}
              setDragOver={setDragOver}
              fileInputRef={fileInputRef}
              handleFiles={handleFiles}
              removeFile={removeFile}
              uploadAll={uploadAll}
              clearDone={clearDone}
              formatSize={formatSize}
            />
          )}

          {activeTab === 'documents' && (
            <DocumentsPanel
              subject={teacherSubject}
              documents={documents}
              formatSize={formatSize}
              deletingDocName={deletingDocName}
              setDeletingDocName={setDeletingDocName}
              onDelete={executeDeleteDocument}
            />
          )}

          {activeTab === 'prerequisites' && (
            <PrerequisitesPanel
              subject={teacherSubject}
              prerequisites={prerequisites}
              loading={loadingPrereqs}
              search={prereqSearch}
              setSearch={setPrereqSearch}
              onAdd={() => setShowAddModal(true)}
              onRefresh={fetchPrerequisites}
              renderCard={(topic, prereqs) => (
                <TopicCard
                  key={topic}
                  topic={topic}
                  prereqs={prereqs}
                  isEditing={editingTopic === topic}
                  editPrereqsList={editPrereqsList}
                  editNewChipInput={editNewChipInput}
                  setEditNewChipInput={setEditNewChipInput}
                  onStartEdit={() => handleStartEdit(topic, prereqs)}
                  onCancelEdit={handleCancelEdit}
                  onSave={() => handleSaveEdit(topic)}
                  onDelete={() => handleDeleteTopic(topic)}
                  onAddChip={handleAddChipToEdit}
                  onRemoveChip={handleRemoveChipFromEdit}
                  isSavingEdit={isSavingEdit}
                />
              )}
            />
          )}
        </div>
      </div>

      {showAddModal && (
        <AddTopicModal
          subject={teacherSubject}
          onClose={() => setShowAddModal(false)}
          onSubmit={handleAddTopic}
          newTopicName={newTopicName}
          setNewTopicName={setNewTopicName}
          newPrereqInput={newPrereqInput}
          setNewPrereqInput={setNewPrereqInput}
          newTopicPrereqs={newTopicPrereqs}
          onAddChip={handleAddChipToNewTopic}
          onRemoveChip={handleRemoveChipFromNewTopic}
          isSubmitting={isSubmittingTopic}
        />
      )}
    </AppShell>
  )
}
