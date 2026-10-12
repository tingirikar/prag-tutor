import { useState, useEffect, useRef, useCallback } from 'react'
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RefreshCw,
  Download,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  FileText,
  Layers,
} from 'lucide-react'

export default function Lightbox({ image, username, token, onClose }) {
  if (!image) return null

  // Normalize image data (supports both direct image object and { image, images, index })
  const imageList = Array.isArray(image.images) && image.images.length > 0
    ? image.images
    : [image.image || image]

  const initialIdx = typeof image.index === 'number' && image.index >= 0 && image.index < imageList.length
    ? image.index
    : Math.max(0, imageList.findIndex(item => (item.url || item) === (image.url || image.image?.url)))

  const [currentIndex, setCurrentIndex] = useState(initialIdx)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [rotation, setRotation] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 })
  const [loading, setLoading] = useState(true)

  const containerRef = useRef(null)
  const authToken = token || sessionStorage.getItem('authToken') || localStorage.getItem('authToken') || ''

  const currentImage = imageList[currentIndex] || imageList[0] || {}

  // Build authenticated image source URL
  const getImageSrc = useCallback((imgObj) => {
    if (!imgObj?.url) return ''
    const cleanUrl = imgObj.url.startsWith('/api') ? imgObj.url : `/api${imgObj.url.startsWith('/') ? '' : '/'}${imgObj.url}`
    const separator = cleanUrl.includes('?') ? '&' : '?'
    return `${cleanUrl}${separator}u=${encodeURIComponent(username || 'student')}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}`
  }, [authToken, username])

  const src = getImageSrc(currentImage)

  // Reset transform state when switching images
  const resetTransform = useCallback(() => {
    setScale(1)
    setPan({ x: 0, y: 0 })
    setRotation(0)
    setLoading(true)
  }, [])

  const handleNext = useCallback(() => {
    if (currentIndex < imageList.length - 1) {
      resetTransform()
      setCurrentIndex(prev => prev + 1)
    }
  }, [currentIndex, imageList.length, resetTransform])

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      resetTransform()
      setCurrentIndex(prev => prev - 1)
    }
  }, [currentIndex, resetTransform])

  // Smart Auto-Scale on load for small diagrams or math snippets
  const handleImageLoad = (e) => {
    setLoading(false)
    const img = e.target
    const nw = img.naturalWidth || 0
    const nh = img.naturalHeight || 0
    setNaturalSize({ width: nw, height: nh })

    // If diagram is very small (like formula snippets), auto-scale to comfortable reading size
    if (nw > 0 && nw < 450) {
      const autoScale = Math.min(3.0, Math.max(1.8, Math.round((550 / nw) * 10) / 10))
      setScale(autoScale)
    } else {
      setScale(1)
    }
  }

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowRight') {
        handleNext()
      } else if (e.key === 'ArrowLeft') {
        handlePrev()
      } else if (e.key === '+' || e.key === '=') {
        setScale(s => Math.min(5, Math.round((s + 0.25) * 100) / 100))
      } else if (e.key === '-' || e.key === '_') {
        setScale(s => Math.max(0.3, Math.round((s - 0.25) * 100) / 100))
      } else if (e.key === '0') {
        setScale(1)
        setPan({ x: 0, y: 0 })
        setRotation(0)
      } else if (e.key === 'r' || e.key === 'R') {
        setRotation(r => (r + 90) % 360)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleNext, handlePrev, onClose])

  // Mouse Wheel Zoom
  const handleWheel = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const zoomStep = 0.18
    const factor = e.deltaY < 0 ? 1 + zoomStep : 1 - zoomStep
    setScale(prev => {
      const next = prev * factor
      return Math.min(5, Math.max(0.3, Math.round(next * 100) / 100))
    })
  }

  // Mouse Drag to Pan
  const handleMouseDown = (e) => {
    if (e.button !== 0) return // Left click only
    setIsDragging(true)
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
  }

  const handleMouseMove = (e) => {
    if (!isDragging) return
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  // Double-click toggle zoom
  const handleDoubleClick = () => {
    if (scale > 1.4) {
      setScale(1)
      setPan({ x: 0, y: 0 })
    } else {
      setScale(2.5)
    }
  }

  // Zoom controls
  const handleZoomIn = () => setScale(s => Math.min(5, Math.round((s + 0.25) * 100) / 100))
  const handleZoomOut = () => setScale(s => Math.max(0.3, Math.round((s - 0.25) * 100) / 100))
  const handleRotate = () => setRotation(r => (r + 90) % 360)
  const handleReset = () => {
    setScale(1)
    setPan({ x: 0, y: 0 })
    setRotation(0)
  }

  // Download image file directly
  const handleDownload = async () => {
    try {
      const res = await fetch(src)
      const blob = await res.blob()
      const blobUrl = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = currentImage.filename || `${currentImage.document || 'diagram'}_p${(currentImage.page ?? 0) + 1}.jpg`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(blobUrl)
    } catch {
      window.open(src, '_blank')
    }
  }

  // Toggle Fullscreen on container
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.().catch(() => {})
      setIsFullscreen(true)
    } else {
      document.exitFullscreen?.().catch(() => {})
      setIsFullscreen(false)
    }
  }

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[120] flex flex-col bg-black/92 backdrop-blur-2xl text-white select-none animate-fade-in"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* ── Top Bar / Header ────────────────────────────────────────────── */}
      <header className="relative z-20 flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-black/40 px-4 backdrop-blur-md sm:px-6">
        {/* Document Info */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/10 text-white/90 ring-1 ring-white/15">
            <FileText size={16} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold tracking-tight text-white/95">
                {currentImage.document || 'Course Diagram'}
              </span>
              {typeof currentImage.page === 'number' && (
                <span className="shrink-0 rounded-md bg-white/10 px-2 py-0.5 font-mono text-[11px] font-medium text-white/80">
                  Page {currentImage.page + 1}
                </span>
              )}
            </div>
            {imageList.length > 1 && (
              <p className="font-mono text-[11px] text-white/60">
                Figure {currentIndex + 1} of {imageList.length}
              </p>
            )}
          </div>
        </div>

        {/* Center Floating Toolbar */}
        <div className="hidden items-center gap-1 rounded-2xl border border-white/15 bg-white/10 px-2 py-1 shadow-2xl backdrop-blur-xl md:flex">
          <button
            type="button"
            onClick={handleZoomOut}
            title="Zoom Out (-)"
            className="grid size-8 place-items-center rounded-lg text-white/80 transition hover:bg-white/15 hover:text-white"
          >
            <ZoomOut size={16} />
          </button>

          <button
            type="button"
            onClick={handleReset}
            title="Click to reset zoom (0)"
            className="min-w-[56px] px-2 py-1 text-center font-mono text-xs font-semibold tracking-wide text-white transition hover:text-accent-soft"
          >
            {Math.round(scale * 100)}%
          </button>

          <button
            type="button"
            onClick={handleZoomIn}
            title="Zoom In (+)"
            className="grid size-8 place-items-center rounded-lg text-white/80 transition hover:bg-white/15 hover:text-white"
          >
            <ZoomIn size={16} />
          </button>

          <div className="mx-1 h-4 w-px bg-white/20" />

          <button
            type="button"
            onClick={handleRotate}
            title="Rotate 90° (R)"
            className="grid size-8 place-items-center rounded-lg text-white/80 transition hover:bg-white/15 hover:text-white"
          >
            <RotateCw size={15} />
          </button>

          <button
            type="button"
            onClick={handleReset}
            title="Reset to 100% (0)"
            className="grid size-8 place-items-center rounded-lg text-white/80 transition hover:bg-white/15 hover:text-white"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleDownload}
            title="Download image"
            className="grid size-9 place-items-center rounded-xl bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white"
          >
            <Download size={16} />
          </button>

          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            title="Open full resolution in new tab"
            className="grid size-9 place-items-center rounded-xl bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white"
          >
            <ExternalLink size={16} />
          </a>

          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            className="hidden size-9 place-items-center rounded-xl bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white sm:grid"
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-9 place-items-center rounded-xl bg-white/20 text-white shadow-lg transition hover:bg-rose-600 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {/* ── Interactive Canvas Viewport ─────────────────────────────────── */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        style={{ cursor: isDragging ? 'grabbing' : scale > 1 ? 'grab' : 'default' }}
      >
        {/* Previous Image Side Button */}
        {imageList.length > 1 && currentIndex > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handlePrev() }}
            title="Previous diagram (Left Arrow)"
            className="absolute left-4 z-30 grid size-12 place-items-center rounded-full border border-white/20 bg-black/60 text-white shadow-2xl backdrop-blur-xl transition hover:scale-110 hover:bg-black/90 active:scale-95"
          >
            <ChevronLeft size={24} />
          </button>
        )}

        {/* Next Image Side Button */}
        {imageList.length > 1 && currentIndex < imageList.length - 1 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleNext() }}
            title="Next diagram (Right Arrow)"
            className="absolute right-4 z-30 grid size-12 place-items-center rounded-full border border-white/20 bg-black/60 text-white shadow-2xl backdrop-blur-xl transition hover:scale-110 hover:bg-black/90 active:scale-95"
          >
            <ChevronRight size={24} />
          </button>
        )}

        {/* Loading Spinner */}
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <div className="size-9 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          </div>
        )}

        {/* The Diagram Stage Card */}
        <div
          className="relative flex items-center justify-center transition-transform duration-75 ease-out"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale}) rotate(${rotation}deg)`,
            transformOrigin: 'center center',
          }}
        >
          <div className="group relative overflow-hidden rounded-2xl border border-white/20 bg-white p-3 shadow-[0_30px_90px_rgba(0,0,0,0.85)] ring-1 ring-black/10">
            <img
              src={src}
              alt={currentImage.source === 'document' ? `Diagram from ${currentImage.document}` : 'Diagram'}
              onLoad={handleImageLoad}
              draggable={false}
              className="max-h-[72vh] max-w-[85vw] object-contain select-none"
              style={{
                minWidth: naturalSize.width && naturalSize.width < 320 ? '340px' : 'auto',
                minHeight: naturalSize.height && naturalSize.height < 180 ? '180px' : 'auto',
                imageRendering: 'auto',
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Bottom Filmstrip & Controls ─────────────────────────────────── */}
      <footer className="relative z-20 flex shrink-0 flex-col items-center justify-between gap-2 border-t border-white/10 bg-black/50 px-4 py-2.5 backdrop-blur-md sm:flex-row sm:px-6">
        {/* Multi-Image Thumbnail Filmstrip */}
        {imageList.length > 1 ? (
          <div className="flex items-center gap-2 overflow-x-auto py-1 scroll-thin">
            <div className="flex items-center gap-1.5 text-xs text-white/50">
              <Layers size={13} />
              <span>Diagrams:</span>
            </div>
            {imageList.map((thumb, idx) => {
              const active = idx === currentIndex
              const thumbSrc = getImageSrc(thumb)
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => { resetTransform(); setCurrentIndex(idx) }}
                  className={`group relative h-10 w-14 shrink-0 overflow-hidden rounded-lg border bg-white/10 transition hover:scale-105 ${
                    active ? 'border-accent ring-2 ring-accent' : 'border-white/20 opacity-60 hover:opacity-100'
                  }`}
                  title={`View diagram ${idx + 1}`}
                >
                  <img
                    src={thumbSrc}
                    alt={`Thumb ${idx + 1}`}
                    className="size-full object-cover"
                  />
                  <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[9px] font-mono text-center text-white/90 leading-tight">
                    p.{thumb.page + 1}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="font-mono text-xs text-white/50">
            {naturalSize.width > 0 ? `${naturalSize.width} × ${naturalSize.height} px` : 'High-definition course diagram'}
          </div>
        )}

        {/* Keyboard Hints */}
        <div className="hidden font-mono text-[11px] text-white/45 lg:block">
          <span>Scroll to zoom</span> · <span>Drag to pan</span> · <span>Double-click to toggle 2.5x</span> · <span>Esc to close</span>
        </div>
      </footer>
    </div>
  )
}
