import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../components/layout/AppShell'
import NavItem from '../components/layout/NavItem'
import UserFooter from '../components/layout/UserFooter'
import Brand from '../components/ui/Brand'
import SubjectIcon from '../components/ui/SubjectIcon'
import SubjectHub from '../components/chat/SubjectHub'
import ChatSidebar from '../components/chat/ChatSidebar'
import ChatWelcome from '../components/chat/ChatWelcome'
import MessageBubble from '../components/chat/MessageBubble'
import ThinkingPanel from '../components/chat/ThinkingPanel'
import Composer from '../components/chat/Composer'
import Lightbox from '../components/chat/Lightbox'
import Quiz from '../components/Quiz/Quiz'
import QuizInvite from '../components/Quiz/QuizInvite'
import QuizResult from '../components/Quiz/QuizResult'
import { apiFetch } from '../api'
import { ArrowUpRight, LayoutGrid, RefreshCw } from 'lucide-react'

export default function StudentDashboard() {
  const navigate = useNavigate()
  const messagesEndRef = useRef(null)

  // Auth guard & user data
  const [currentUser, setCurrentUser] = useState(() => JSON.parse(sessionStorage.getItem('user') || '{}'))

  useEffect(() => {
    const user = JSON.parse(sessionStorage.getItem('user') || '{}')
    if (user.role !== 'student') {
      navigate('/', { replace: true })
    } else {
      setCurrentUser(user)
    }
  }, [navigate])

  // Subject state: null = Subject Selection Hub View; { code, name, ... } = Chat View
  const [subjects, setSubjects] = useState([
    {
      code: 'DSA',
      name: 'Data Structures & Algorithms',
      description: 'Master linear & non-linear structures, recursion, trees, graphs, sorting, and complexity analysis.',
      teacherUsername: 'dsa',
      teacherName: 'Dr. Sarah (DSA Faculty)'
    },
    {
      code: 'ML',
      name: 'Machine Learning',
      description: 'Explore supervised & unsupervised learning, cost functions, gradient descent, neural networks, and evaluation.',
      teacherUsername: 'ml',
      teacherName: 'Prof. Alan (ML Faculty)'
    },
    {
      code: 'CN',
      name: 'Computer Networks',
      description: 'OSI & TCP/IP stack, routing protocols, flow control, congestion avoidance, sockets, and network security.',
      teacherUsername: 'cn',
      teacherName: 'Dr. Kevin (CN Faculty)'
    },
    {
      code: 'OS',
      name: 'Operating Systems',
      description: 'Process management, concurrency, memory paging, virtual memory, storage, and file systems.',
      teacherUsername: 'os',
      teacherName: 'Prof. Linus (OS Faculty)'
    }
  ])
  const [selectedSubject, setSelectedSubject] = useState(null)

  // Conversations state (MongoDB chat history)
  const [conversations, setConversations] = useState([])
  const [currentConversationId, setCurrentConversationId] = useState(null)
  const [deletingConvId, setDeletingConvId] = useState(null)

  // Chat message & interaction state
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [level, setLevel] = useState('beginner')
  const [loading, setLoading] = useState(false)
  const [sampleQuestions, setSampleQuestions] = useState([])
  const [refreshingQuestions, setRefreshingQuestions] = useState(false)
  const [expandedSources, setExpandedSources] = useState({})
  const [imageMode, setImageMode] = useState('none')
  const [model, setModel] = useState('openai/gpt-oss-20b')
  const [provider, setProvider] = useState('groq')
  const [cloudModels, setCloudModels] = useState([
    { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B (Default)', provider: 'groq' },
    { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'groq' },
    { id: 'qwen/qwen3.8-27b', name: 'Qwen 3.8 27B', provider: 'groq' },
  ])
  const [localModels, setLocalModels] = useState([
    { id: 'llama3.2:3b', name: 'llama3.2:3b', provider: 'local' },
  ])
  const [isCustomModel, setIsCustomModel] = useState(false)
  const [customModelInput, setCustomModelInput] = useState('')
  const [lightboxImage, setLightboxImage] = useState(null)
  const [thinkingOpen, setThinkingOpen] = useState(false)
  const [thinkingSteps, setThinkingSteps] = useState([])

  // Quiz flow state
  const [quizMode, setQuizMode] = useState(null) // null | 'invite' | 'active' | 'result'
  const [activeQuiz, setActiveQuiz] = useState(null)
  const [quizResult, setQuizResult] = useState(null)
  const [queryCount, setQueryCount] = useState(0)

  const [ollamaOnline, setOllamaOnline] = useState(false)

  // Load subjects & available models on mount
  useEffect(() => {
    apiFetch('/api/subjects')
      .then(res => res.json())
      .then(data => {
        if (data.subjects && data.subjects.length > 0) {
          setSubjects(data.subjects)
        }
      })
      .catch(err => console.warn('Could not load subjects from API:', err))

    apiFetch('/api/models')
      .then(res => res.json())
      .then(data => {
        if (data.cloud_models && data.cloud_models.length > 0) setCloudModels(data.cloud_models)
        if (data.local_models && data.local_models.length > 0) setLocalModels(data.local_models)
        setOllamaOnline(Boolean(data.ollama_online))
      })
      .catch(err => console.warn('Could not load dynamic models list:', err))
  }, [])

  // Fetch subject-specific sample questions
  const fetchSampleQuestions = async (subjectCode = selectedSubject?.code) => {
    if (!subjectCode) {
      setSampleQuestions([])
      return
    }
    setRefreshingQuestions(true)
    try {
      const seed = Math.random().toString(36).substring(2, 10)
      const res = await apiFetch(`/api/sample-questions?seed=${seed}&subject=${encodeURIComponent(subjectCode)}`)
      if (!res.ok) throw new Error('Could not refresh questions')
      const data = await res.json()
      if (data.questions && Array.isArray(data.questions) && data.questions.length > 0) {
        setSampleQuestions(data.questions)
      } else {
        setSampleQuestions([])
      }
    } catch {
      setSampleQuestions([])
    } finally {
      setRefreshingQuestions(false)
    }
  }

  // Load conversations for a subject
  const fetchConversations = async (subjectCode) => {
    const studentUser = JSON.parse(sessionStorage.getItem('user') || '{}')
    try {
      const res = await apiFetch(`/api/conversations?studentUsername=${encodeURIComponent(studentUser.username || 'student')}&subject=${encodeURIComponent(subjectCode)}`)
      const data = await res.json()
      if (data.conversations) {
        setConversations(data.conversations)
      }
    } catch (err) {
      console.error('Failed to fetch conversations:', err)
    }
  }

  // Check whether student owes a compulsory quiz in current subject
  const checkPendingQuizStatus = async (subjectCode) => {
    const studentUser = JSON.parse(sessionStorage.getItem('user') || '{}')
    const username = studentUser.username || 'student'
    try {
      const res = await apiFetch(`/api/quiz/status?studentUsername=${encodeURIComponent(username)}&subject=${encodeURIComponent(subjectCode)}`)
      if (res.ok) {
        const data = await res.json()
        if (data.compulsory && Array.isArray(data.questions) && data.questions.length > 0) {
          setActiveQuiz({
            quizSetId: null,
            quizSetIds: data.quizSetIds || [],
            questions: data.questions,
            total: data.total || data.questions.length,
            compulsory: true,
            conversationId: null,
          })
          setQuizMode('active')
          return true
        }
      }
    } catch (e) {
      console.warn('Could not check pending quiz status:', e)
    }
    return false
  }

  // Handle selecting a subject from the hub
  const selectSubject = async (subj) => {
    setSelectedSubject(subj)
    setCurrentConversationId(null)
    setMessages([])
    setInput('')
    setImageMode('none')
    setQuizMode(null)
    setActiveQuiz(null)
    setQuizResult(null)
    setQueryCount(0)
    fetchSampleQuestions(subj.code)
    fetchConversations(subj.code)
    await checkPendingQuizStatus(subj.code)
  }

  // Return to the Subject Hub Dashboard
  const backToSubjects = () => {
    setSelectedSubject(null)
    setCurrentConversationId(null)
    setMessages([])
    setInput('')
    setQuizMode(null)
    setActiveQuiz(null)
    setQuizResult(null)
    setQueryCount(0)
  }

  // Load a saved conversation from MongoDB
  const loadConversation = async (convId) => {
    if (loading || convId === currentConversationId) return
    try {
      setLoading(true)
      setQuizMode(null)
      setActiveQuiz(null)
      setQuizResult(null)
      setQueryCount(0)
      const res = await apiFetch(`/api/conversations/${convId}?studentUsername=${encodeURIComponent(currentUser.username || 'student')}`)
      const data = await res.json()
      if (data.conversation) {
        setCurrentConversationId(convId)
        setMessages(data.conversation.messages || [])
        // Restore query count from saved conversation
        setQueryCount(data.conversation.query_count || 0)
        setExpandedSources({})

        const quizStatus = data.conversation.quiz_status
        if (quizStatus?.available && quizStatus.questions?.length > 0) {
          setActiveQuiz({
            quizSetId: null,
            quizSetIds: quizStatus.quizSetIds || [],
            questions: quizStatus.questions,
            total: quizStatus.total || quizStatus.questions.length,
            compulsory: true,
            conversationId: convId,
          })
          setQuizMode('active')
        }
      }
    } catch (err) {
      console.error('Failed to load conversation:', err)
    } finally {
      setLoading(false)
    }
  }

  // Inline delete handlers (zero popups)
  const confirmDelete = async (convId, e) => {
    e.stopPropagation()
    try {
      await apiFetch(`/api/conversations/${convId}?studentUsername=${encodeURIComponent(currentUser.username || 'student')}`, { method: 'DELETE' })
      setConversations(prev => prev.filter(c => c._id !== convId))
      setDeletingConvId(null)
      if (currentConversationId === convId) {
        startNewChat()
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err)
      setDeletingConvId(null)
    }
  }

  const cancelDelete = (e) => {
    e.stopPropagation()
    setDeletingConvId(null)
  }

  // Start a new chat thread for current subject
  const startNewChat = async () => {
    setCurrentConversationId(null)
    setMessages([])
    setExpandedSources({})
    setInput('')
    setImageMode('none')
    setQuizMode(null)
    setActiveQuiz(null)
    setQuizResult(null)
    setQueryCount(0)
    if (selectedSubject?.code) {
      await checkPendingQuizStatus(selectedSubject.code)
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(scrollToBottom, [messages, loading, quizMode])

  // Thinking progress simulation
  useEffect(() => {
    if (!loading || thinkingSteps.length === 0) return undefined

    let activeStep = 0
    const timer = window.setInterval(() => {
      activeStep += 1
      setThinkingSteps(prev => prev.map((step, index) => ({
        ...step,
        status: index < activeStep ? 'done' : index === activeStep ? 'active' : 'pending'
      })))
      if (activeStep >= thinkingSteps.length - 1) window.clearInterval(timer)
    }, 850)

    return () => window.clearInterval(timer)
  }, [loading, thinkingSteps.length])

  const toggleSources = (index) => {
    setExpandedSources(prev => ({
      ...prev,
      [index]: !prev[index]
    }))
  }

  const handleModelChange = (eOrVal) => {
    const val = typeof eOrVal === 'string' ? eOrVal : eOrVal?.target?.value
    if (!val) return
    if (val === 'custom_local') {
      setIsCustomModel(true)
      setProvider('local')
    } else {
      setIsCustomModel(false)
      const [prov, ...rest] = val.split(':')
      const modelId = rest.join(':')
      setProvider(prov)
      setModel(modelId)
    }
  }

  const handleAsk = async (queryText, chosenLevel = level, topicHint = null) => {
    const query = queryText.trim()
    if (!query || loading || !selectedSubject) return

    setQuizMode(null)
    setActiveQuiz(null)
    setQuizResult(null)

    const activeModelName = isCustomModel ? (customModelInput.trim() || 'llama3.2:3b') : model

    // Multi-turn history: send previous conversation turns
    const history = messages.map(m => ({
      role: m.role,
      content: m.content
    }))

    // Add user message to UI immediately
    setMessages(prev => [...prev, { role: 'user', content: query }])
    setInput('')
    setThinkingOpen(false)
    const steps = [
      { label: `Searching ${selectedSubject.name} curriculum`, status: 'active' },
      { label: 'Verifying course concepts', status: 'pending' },
    ]
    if (imageMode === 'mermaid') {
      steps.push({
        label: 'Generating interactive Mermaid diagram',
        status: 'pending'
      })
    } else if (imageMode === 'notes') {
      steps.push({
        label: 'Checking course notes for genuine diagrams',
        status: 'pending'
      })
    }
    steps.push({
      label: provider === 'local' ? `Generating response with local model (${activeModelName})` : `Generating response with Groq cloud (${activeModelName})`,
      status: 'pending'
    })
    setThinkingSteps(steps)
    const thinkingStart = Date.now()
    setLoading(true)

    try {
      const res = await apiFetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          topic: topicHint || undefined,
          subject: selectedSubject.code,
          studentUsername: currentUser.username || 'student',
          conversationId: currentConversationId,
          level: chosenLevel,
          model: activeModelName,
          provider,
          history,
          include_image: false,
          image_mode: imageMode,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to get response from tutor')
      }

      const answerText = data.response || data.answer || 'No answer generated.'
      const assistantMessageId = crypto.randomUUID()

      // Track active conversation ID, query count, and refresh sidebar list
      if (data.conversationId) {
        setCurrentConversationId(data.conversationId)
        fetchConversations(selectedSubject.code)
      }
      if (typeof data.query_count === 'number') {
        setQueryCount(data.query_count)
      }

      setMessages(prev => [
        ...prev,
        {
          id: assistantMessageId,
          role: 'assistant',
          content: answerText,
          topic: data.topic || null,
          prerequisites: data.prerequisites || [],
          exploreNext: data.explore_next || [],
          rejected: Boolean(data.rejected),
          status: data.status || null,
          sources: data.sources || [],
          images: data.images || [],
          imagesLoading: !data.rejected && imageMode === 'notes',
          level: chosenLevel,
          model: data.model || activeModelName,
          provider: data.provider || provider,
          thinking: { steps: steps.map(st => ({ label: st.label, status: 'done' })), seconds: Math.max(1, Math.round((Date.now() - thinkingStart) / 1000)) },
        },
      ])

      setLoading(false)

      if (typeof data.query_count === 'number') {
        setQueryCount(data.query_count)
      }

      // Handle quiz generation response:
      if (data.quiz?.compulsory && data.quiz.questions?.length > 0) {
        setActiveQuiz({
          quizSetId: data.quiz.quizSetId,
          quizSetIds: data.quiz.quizSetIds || [],
          questions: data.quiz.questions,
          total: data.quiz.total || data.quiz.questions.length,
          compulsory: true,
          conversationId: data.conversationId || currentConversationId,
        })
        setQuizMode('active')
      } else if (data.quiz?.available && data.quiz.quizSetId) {
        setActiveQuiz({
          quizSetId: data.quiz.quizSetId,
          quizSetIds: data.quiz.quizSetIds || [],
          questions: [],
          total: data.quiz.total || 3,
          compulsory: false,
          conversationId: data.conversationId || currentConversationId,
        })
        setQuizMode('invite')
      } else {
        setQuizMode(null)
        setActiveQuiz(null)
      }

      if (imageMode === 'notes' && !data.rejected) {
        apiFetch('/api/query/images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            topic: data.topic || '',
            mode: 'notes',
            subject: selectedSubject.code,
            conversationId: data.conversationId || currentConversationId,
            messageId: assistantMessageId,
            studentUsername: currentUser.username || 'student',
          }),
        })
          .then(async imageRes => {
            const imageData = await imageRes.json()
            if (!imageRes.ok) throw new Error(imageData.error || 'Could not load diagrams')
            setMessages(prev => prev.map(message => (
              message.id === assistantMessageId
                ? { ...message, images: imageData.images || [], imagesLoading: false }
                : message
            )))
          })
          .catch(err => {
            console.error('Diagram loading error:', err)
            setMessages(prev => prev.map(message => (
              message.id === assistantMessageId
                ? { ...message, imagesLoading: false }
                : message
            )))
          })
      }

    } catch (err) {
      console.error('Chat error:', err)
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${err.message || 'Could not reach the tutor server. Please make sure the backend is running.'}`,
          topic: null,
          prerequisites: [],
          sources: [],
          images: [],
          imagesLoading: false
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  const pendingSample = useRef(null)

  const sendMessage = (e) => {
    e.preventDefault()
    const hint = pendingSample.current && pendingSample.current.question === input.trim() ? pendingSample.current.topic : null
    pendingSample.current = null
    handleAsk(input, level, hint)
  }

  const handleSelectSample = (sample) => {
    pendingSample.current = sample
    if (sample.level) setLevel(sample.level)
    setInput(sample.question)
    requestAnimationFrame(() => {
      const el = document.getElementById('chat-composer')
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) }
    })
  }

  const handleSelectPrerequisite = (question, topic) => {
    pendingSample.current = { question, topic }
    setInput(question)
    requestAnimationFrame(() => {
      const el = document.getElementById('chat-composer')
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) }
    })
  }

  const logout = () => {
    sessionStorage.removeItem('user')
    sessionStorage.removeItem('authToken')
    navigate('/')
  }

  // ==========================================
  // VIEW 1: SUBJECT SELECTION HUB (DASHBOARD)
  // ==========================================
  if (!selectedSubject) {
    return (
      <AppShell
        sidebar={(close) => (
          <>
            <div className="p-4 pt-5"><Brand /></div>
            <nav className="flex-1 space-y-1 px-3 pt-4">
              <div className="px-3 pb-2 font-mono text-[10.5px] tracking-[0.16em] text-mute uppercase">Navigation</div>
              <NavItem active icon={<LayoutGrid size={17} />} label="Subject Hub" onClick={close} />
            </nav>
            <UserFooter
              initial={currentUser.name?.charAt(0) || 'S'}
              name={currentUser.name || 'Student'}
              role="Student"
              logoutLabel="Sign Out"
              onLogout={logout}
            />
          </>
        )}
      >
        <SubjectHub user={currentUser} subjects={subjects} onSelect={selectSubject} />
      </AppShell>
    )
  }

  // Dropup options and formatted display labels
  const levelOptions = [
    { value: 'beginner', label: 'Beginner' },
    { value: 'intermediate', label: 'Intermediate' },
    { value: 'expert', label: 'Expert' },
  ]
  const currentLevelLabel = levelOptions.find(o => o.value === level)?.label || 'Beginner'

  const modelOptions = [
    {
      group: 'Online / Cloud (Groq)',
      items: cloudModels.map(m => ({
        value: `groq:${m.id}`,
        label: m.name || m.id,
      })),
    },
    ollamaOnline ? {
      group: 'Local (Ollama - Online)',
      items: [
        ...localModels.map(m => ({
          value: `local:${m.id}`,
          label: `${m.name || m.id} (Local)`,
        })),
        { value: 'custom_local', label: '+ Enter custom local model...' },
      ],
    } : {
      group: 'Local (Ollama - Not Running)',
      items: [
        { value: 'offline', label: "Ollama offline (Start with 'ollama serve')", disabled: true },
      ],
    },
  ]

  let currentModelLabel = 'Select Model'
  if (isCustomModel) {
    currentModelLabel = customModelInput ? `Custom: ${customModelInput}` : '+ Enter custom local model...'
  } else {
    const currentVal = `${provider}:${model}`
    const cloudMatch = cloudModels.find(m => `groq:${m.id}` === currentVal)
    if (cloudMatch) {
      currentModelLabel = cloudMatch.name || cloudMatch.id
    } else {
      const localMatch = localModels.find(m => `local:${m.id}` === currentVal)
      if (localMatch) {
        currentModelLabel = `${localMatch.name || localMatch.id} (Local)`
      } else if (model) {
        currentModelLabel = model
      }
    }
  }

  const diagramOptions = [
    { value: 'none', label: 'No diagrams' },
    { value: 'notes', label: 'Notes diagrams (PDF)' },
    { value: 'mermaid', label: 'Mermaid diagrams (Interactive)' },
  ]
  const currentDiagramLabel = diagramOptions.find(o => o.value === imageMode)?.label || 'Diagrams'

  // ==========================================
  // VIEW 2: TUTOR CHAT WORKSPACE (SCOPED TO SUBJECT)
  // ==========================================
  return (
    <AppShell
      mobileTitle={
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-accent"><SubjectIcon code={selectedSubject.code} size={16} /></span>
          <span className="truncate text-sm font-medium">{selectedSubject.name}</span>
        </div>
      }
      sidebar={(close) => (
        <ChatSidebar
          close={close}
          subject={selectedSubject}
          conversations={conversations}
          currentConversationId={currentConversationId}
          deletingConvId={deletingConvId}
          onBack={backToSubjects}
          onNewChat={startNewChat}
          onLoad={loadConversation}
          onAskDelete={setDeletingConvId}
          onConfirmDelete={confirmDelete}
          onCancelDelete={cancelDelete}
          user={currentUser}
          onLogout={logout}
        />
      )}
    >
      <div className="flex h-full flex-col">
        {/* Desktop header */}
        <div className="hidden h-14 shrink-0 items-center justify-between border-b border-line px-6 lg:flex in-[.rail-collapsed]:pl-16">
          <div className="flex min-w-0 items-center gap-2.5 text-sm">
            <span className="text-accent"><SubjectIcon code={selectedSubject.code} size={16} /></span>
            <span className="font-medium text-fg">{selectedSubject.name}</span>
            <span className="text-mute">/</span>
            <span className="truncate text-dim">
              {conversations.find(c => c._id === currentConversationId)?.title || 'New Chat'}
            </span>
          </div>
          <span className="font-mono text-[11px] text-mute">{selectedSubject.teacherName || selectedSubject.teacherUsername}</span>
        </div>

        {/* Messages Feed */}
        <div className="min-h-0 flex-1 overflow-y-auto scroll-none">
          <div className="mx-auto w-full max-w-5xl xl:max-w-6xl space-y-6 px-4 py-6 sm:px-8">
            {messages.length === 0 && !loading && (
              <ChatWelcome
                subject={selectedSubject}
                refreshing={refreshingQuestions}
                questions={sampleQuestions}
                onRefresh={() => fetchSampleQuestions(selectedSubject.code)}
                onSelect={handleSelectSample}
              />
            )}

            {messages.map((msg, i) => (
              <MessageBubble
                key={i}
                msg={msg}
                index={i}
                expanded={!!expandedSources[i]}
                onToggleSources={toggleSources}
                onOpenImage={setLightboxImage}
                onAsk={handleSelectPrerequisite}
                username={currentUser.username}
              />
            ))}

            {/* Explore Next inside scrollable message stream:
                - Sticks to the end of the chat
                - Scrolls down out of view when scrolling up to read chat history
                - Clicking populates input; sending hides it until answer finishes
            */}
            {messages.length > 0 && !loading && sampleQuestions.length > 0 && (
              <div className="pt-2 animate-rise">
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="font-mono text-[11px] font-semibold tracking-[0.14em] text-dim uppercase">
                    Explore next:
                  </span>
                  <button
                    type="button"
                    onClick={() => fetchSampleQuestions(selectedSubject.code)}
                    disabled={refreshingQuestions}
                    className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-dim hover:text-accent disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={refreshingQuestions ? 'animate-spin' : ''} />
                    <span>Refresh</span>
                  </button>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {sampleQuestions.slice(0, 4).map((sq, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectSample(sq)}
                      className="group flex items-center justify-between gap-3 rounded-xl border border-line bg-panel p-3.5 text-left shadow-xs transition hover:border-accent hover:bg-accent-soft hover:text-accent-strong"
                    >
                      <span className="text-[13px] font-medium leading-snug text-fg group-hover:text-accent-strong">
                        {sq.question}
                      </span>
                      <ArrowUpRight size={14} className="shrink-0 text-mute transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {loading && (
              <ThinkingPanel
                open={thinkingOpen}
                onToggle={() => setThinkingOpen(prev => !prev)}
                steps={thinkingSteps}
              />
            )}

            {/* Quiz UI Flow */}
            {quizMode === 'invite' && activeQuiz && (
              <QuizInvite
                quizSetId={activeQuiz.quizSetId}
                conversationId={activeQuiz.conversationId || currentConversationId}
                studentUsername={currentUser.username || 'student'}
                subject={selectedSubject.code}
                total={activeQuiz.total || 3}
                onYes={(quizData) => {
                  setActiveQuiz(prev => ({ ...prev, ...quizData }))
                  setQuizMode('active')
                }}
                onNo={() => {
                  setQuizMode(null)
                  setActiveQuiz(null)
                }}
              />
            )}

            {quizMode === 'active' && activeQuiz && (
              <Quiz
                questions={activeQuiz.questions}
                quizSetIds={activeQuiz.quizSetIds}
                conversationId={activeQuiz.conversationId || currentConversationId}
                studentUsername={currentUser.username || 'student'}
                subject={selectedSubject.code}
                compulsory={activeQuiz.compulsory}
                onComplete={(score, total) => {
                  setQuizResult({ score, total })
                  setQuizMode('result')
                  if (selectedSubject?.code) {
                    fetchConversations(selectedSubject.code)
                  }
                }}
              />
            )}

            {quizMode === 'result' && quizResult && (
              <QuizResult
                score={quizResult.score}
                total={quizResult.total}
                onBack={() => {
                  setQuizMode(null)
                  setActiveQuiz(null)
                  setQuizResult(null)
                  if (selectedSubject?.code) {
                    fetchConversations(selectedSubject.code)
                  }
                }}
              />
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Composer area */}
        <div className="shrink-0 bg-linear-to-t from-ink via-ink to-transparent px-3 pt-2 pb-3 sm:px-6 sm:pb-5">
          <div className="mx-auto w-full max-w-5xl xl:max-w-6xl">
            {/* 3-Query Session Progress Indicator */}
            {queryCount > 0 && queryCount < 3 && quizMode === null && (
              <div
                className="mb-2.5 flex items-center gap-3 rounded-xl border border-accent/20 bg-accent-soft px-3.5 py-1.5 text-xs text-dim shadow-2xs"
                title={`Query ${queryCount} of 3 in this learning session`}
              >
                <span className="font-semibold text-accent-strong shrink-0">
                  Session: {queryCount}/3 queries
                  {queryCount === 1 ? ' — 2 more for your quiz' : ' — 1 more for your quiz'}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised border border-line">
                  <div
                    className="h-full bg-accent transition-all duration-300"
                    style={{ width: `${(queryCount / 3) * 100}%` }}
                  />
                </div>
              </div>
            )}

            <Composer
              input={input}
              setInput={setInput}
              onSubmit={sendMessage}
              loading={loading || (quizMode === 'active' && activeQuiz?.compulsory)}
              placeholder={
                quizMode === 'active' && activeQuiz?.compulsory
                  ? 'Compulsory quiz in progress — complete the quiz above to continue chatting...'
                  : `Ask a question about ${selectedSubject.name}...`
              }
              level={level}
              levelLabel={currentLevelLabel}
              levelOptions={levelOptions}
              onLevelChange={setLevel}
              modelValue={isCustomModel ? 'custom_local' : `${provider}:${model}`}
              modelLabel={currentModelLabel}
              modelOptions={modelOptions}
              onModelChange={handleModelChange}
              showCustomModel={isCustomModel && ollamaOnline}
              customModelInput={customModelInput}
              setCustomModelInput={setCustomModelInput}
              imageMode={imageMode}
              diagramLabel={currentDiagramLabel}
              diagramOptions={diagramOptions}
              onDiagramChange={setImageMode}
            />
            <p className="mt-2 hidden text-center text-[11px] text-mute sm:block">
              Answers are grounded in {selectedSubject.code} course documents. Verify important details with your sources.
            </p>
          </div>
        </div>
      </div>

      <Lightbox
        image={lightboxImage}
        username={currentUser.username}
        token={sessionStorage.getItem('authToken')}
        onClose={() => setLightboxImage(null)}
      />
    </AppShell>
  )
}
