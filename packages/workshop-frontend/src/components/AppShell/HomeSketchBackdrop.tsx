import { useEffect, useRef, useState } from 'react'
import { runHubSketchAnimation } from './sketch/animation'
import { applyHubLandmarkEdits } from './sketch/hubLandmarks'

// Swap Coit Tower out and Oracle Park in on the shared catalog before any run, as the Hub does.
applyHubLandmarkEdits()

// The Hub's per-landmark scene wash (brick.hub `HubAmbientBackground`): the landmark's hue in the
// sky, grounding into a warm terracotta. Lighter than the Hub's because nothing here sits in glass.
const GROUND = 'rgba(164,142,128,0.06) 48%, rgba(156,120,96,0.10) 74%, rgba(138,104,80,0.14) 100%'
const scene = (top: string, mid: string, glow: string) =>
  `linear-gradient(to bottom, ${top} 0%, ${mid} 32%, ${GROUND}), radial-gradient(60% 44% at 50% 32%, ${glow}, transparent 74%)`
const BLUE = scene('rgba(92,138,178,0.24)', 'rgba(108,142,176,0.12)', 'rgba(66,112,150,0.10)')
const GREEN = scene('rgba(84,134,114,0.24)', 'rgba(98,138,120,0.12)', 'rgba(60,112,92,0.10)')
const VIOLET = scene('rgba(126,114,166,0.24)', 'rgba(136,124,170,0.12)', 'rgba(104,92,148,0.10)')
const DEFAULT_SCENE = `linear-gradient(to bottom, rgba(120,146,170,0.16) 0%, rgba(140,146,160,0.08) 34%, ${GROUND})`
const LANDMARK_SCENE: Record<string, string> = {
  'golden-gate-bridge': BLUE,
  'painted-ladies': BLUE,
  'salesforce-tower': BLUE,
  'bay-bridge': BLUE,
  'ferry-building': BLUE,
  'oracle-park': BLUE,
  'transamerica-pyramid': GREEN,
  'sf-skyline': VIOLET,
}

/**
 * Home backdrop that etches San Francisco landmarks one stroke at a time, ported from the LFIQ
 * Hub's login and launcher background. Each figure gets the Hub's colour wash, crossfaded when the
 * figure changes. The band sits behind the headline and entity row and fades out above the
 * composer; reduced motion paints every landmark at once instead of animating.
 */
export default function HomeSketchBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const speedRef = useRef(0.00038)
  // Two wash layers that swap on each figure change, so the opacity transition dissolves them.
  const [wash, setWash] = useState({ a: DEFAULT_SCENE, b: DEFAULT_SCENE, showA: true })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    return runHubSketchAnimation(canvas, {
      getProgressPerMs: () => speedRef.current,
      onFigureChange: ({ id }) => {
        const next = LANDMARK_SCENE[id] ?? DEFAULT_SCENE
        setWash((w) => (w.showA ? { ...w, b: next, showA: false } : { ...w, a: next, showA: true }))
      },
      strokeStyle: 'rgba(23, 52, 84, 0.34)',
      lineWidth: 1.5,
      linesPerTick: (id) =>
        id === 'oracle-park' || id === 'transamerica-pyramid' || id === 'salesforce-tower' ? 3 : 1,
    })
  }, [])

  const fade = 'linear-gradient(to bottom, #000 0%, #000 55%, transparent 92%)'
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[320px] overflow-hidden"
      style={{ maskImage: fade, WebkitMaskImage: fade }}
    >
      {(['a', 'b'] as const).map((layer) => (
        <div
          key={layer}
          className="absolute inset-0 transition-opacity duration-[1200ms] ease-in-out motion-reduce:transition-none dark:opacity-50"
          style={{
            backgroundImage: wash[layer],
            opacity: (layer === 'a') === wash.showA ? undefined : 0,
          }}
        />
      ))}
      {/* A fixed aspect band, centred, so the normalised figures keep the Hub's proportions. */}
      <div className="absolute left-1/2 top-0 h-full w-full max-w-[1280px] -translate-x-1/2">
        <canvas ref={canvasRef} className="block h-full w-full dark:invert dark:brightness-90" />
      </div>
    </div>
  )
}
