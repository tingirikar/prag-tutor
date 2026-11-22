import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import mermaid from 'mermaid'
import { Network } from 'lucide-react'
import Spinner from '../ui/Spinner'

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  suppressErrorRendering: true,
  fontFamily: 'system-ui, sans-serif',
  securityLevel: 'loose',
  themeVariables: {
    darkMode: false,
    background: '#ffffff',
    primaryColor: '#eef1ff',
    primaryTextColor: '#0f1630',
    primaryBorderColor: '#3b5bfd',
    lineColor: '#6b7fd6',
    secondaryColor: '#f2f4fa',
    tertiaryColor: '#f7f8fc',
    fontFamily: 'system-ui, sans-serif',
  },
})

let nextDiagramId = 0

function MermaidBlock({ code }) {
  const stagingRef = useRef(null)
  const outputRef = useRef(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    let active = true
    const host = stagingRef.current
    async function render() {
      // StrictMode can clean up the first effect before the renderer starts.
      await Promise.resolve()
      if (!active) return
      try {
        const { svg } = await mermaid.render('mmd-' + ++nextDiagramId, code, host)
        if (active) setResult({ svg })
      } catch (error) {
        if (active) {
          console.warn('Could not render Mermaid diagram:', error)
          setResult({ error: true })
        }
      }
    }
    render()
    return () => { active = false }
  }, [code])

  useLayoutEffect(() => {
    const svg = outputRef.current?.querySelector('svg')
    const width = svg?.viewBox.baseVal.width
    // Wide diagrams can scroll inside the frame at their intended text size.
    if (width > 0) svg.style.width = width + 'px'
  }, [result])

  return (
    <figure className="overflow-hidden rounded-xl border border-line bg-panel">
      <figcaption className="flex items-center gap-2 border-b border-line px-4 py-2 text-sm font-medium text-dim">
        <Network size={15} className="text-accent" />
        {result?.error ? 'Diagram source' : 'Mermaid diagram'}
      </figcaption>
      <div className="diagram-frame">
        <div ref={stagingRef} className="diagram-staging" aria-hidden="true" inert />
        {!result ? (
          <div role="status" className="grid h-full place-content-center">
            <span className="flex items-center gap-2 text-sm text-dim"><Spinner /> Loading diagram&hellip;</span>
          </div>
        ) : result.error ? (
          <pre className="!m-0 h-full !rounded-none !border-0"><code>{code}</code></pre>
        ) : (
          <div ref={outputRef} className="diagram-output" dangerouslySetInnerHTML={{ __html: result.svg }} />
        )}
      </div>
    </figure>
  )
}

// Keep the renderer type stable across chat updates. Replace the entire fenced
// block so a diagram never inherits the whitespace and sizing of a <pre>.
const markdownComponents = {
  pre({ node, children }) {
    const element = node.children[0]
    if (element?.tagName === 'code') {
      const code = element.children.map(child => child.value || '').join('').trim()
      const languages = element.properties?.className || []
      const isDiagram = languages.includes('language-mermaid') || (
        !languages.length && /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph)\b/.test(code)
      )
      if (isDiagram) return <MermaidBlock key={code} code={code} />
    }
    return <pre>{children}</pre>
  },
}

function preprocessLaTeX(content) {
  if (!content) return ''
  // 1. Convert display math \[ ... \] to $$ ... $$
  let processed = content.replace(/\\\[([\s\S]*?)\\\]/g, (_match, eq) => `$$\n${eq.trim()}\n$$`)
  // 2. Convert inline math \( ... \) to $ ... $
  processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, (_match, eq) => `$${eq.trim()}$`)

  // 3. Fix unclosed $$ on single lines (e.g. LLM generates "$$ equation" without closing $$ before line break)
  const lines = processed.split('\n')
  const fixedLines = lines.map((line) => {
    const trimmed = line.trim()
    const matches = line.match(/\$\$/g)
    if (matches && matches.length % 2 !== 0) {
      return line.trimEnd() + ' $$'
    }
    // Automatically wrap standalone raw LaTeX math blocks (lines starting with \frac, \boxed, \partial, etc.)
    if (
      trimmed &&
      !trimmed.startsWith('$') &&
      !trimmed.startsWith('-') &&
      !trimmed.startsWith('*') &&
      !trimmed.startsWith('#') &&
      /^\\[a-zA-Z]+/.test(trimmed) &&
      !trimmed.startsWith('\\item')
    ) {
      return `$$ ${trimmed} $$`
    }
    return line
  })

  return fixedLines.join('\n')
}

const Markdown = memo(function Markdown({ content }) {
  if (!content) return null
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false, errorColor: '#7c85a3' }]]}
        components={markdownComponents}
      >
        {preprocessLaTeX(content)}
      </ReactMarkdown>
    </div>
  )
})

export default Markdown
