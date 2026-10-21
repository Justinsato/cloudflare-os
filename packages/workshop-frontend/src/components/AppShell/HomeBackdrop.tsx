/**
 * Home backdrop for a deployment with its own Home: a soft brand-colored glow at the top center over
 * a hairline grid, both fading out before the composer. Pure CSS on theme tokens, so it follows the
 * deployment's palette in light and dark.
 */
export default function HomeBackdrop() {
  const fade = 'radial-gradient(ellipse 70% 100% at 50% 0%, #000 30%, transparent 75%)'
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--color-kumo-line) 1px, transparent 1px),'
            + ' linear-gradient(to bottom, var(--color-kumo-line) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          backgroundPosition: 'center top',
          opacity: 0.55,
          maskImage: fade,
          WebkitMaskImage: fade,
        }}
      />
      <div
        className="absolute left-1/2 top-[-220px] h-[440px] w-[880px] max-w-[160vw] -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: 'color-mix(in srgb, var(--color-kumo-brand) 14%, transparent)' }}
      />
    </div>
  )
}
