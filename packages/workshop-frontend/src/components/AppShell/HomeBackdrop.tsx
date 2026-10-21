/**
 * Home backdrop for a deployment with its own Home: two nested hairline chevrons, the V of the
 * family office mark, drawn in `--home-line-1` and `--home-line-2` (falling back to the brand text
 * color) and fading out above the composer. A dual-brand theme gives each line its own color.
 */
export default function HomeBackdrop() {
  // Gone by ~270px, above the entity row, so the lines never run behind its boxes.
  const fade = 'linear-gradient(to bottom, #000 0%, #000 30%, transparent 64%)'
  const line = (n: 1 | 2) => `var(--home-line-${n}, var(--text-color-kumo-brand))`
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] overflow-hidden"
      style={{ maskImage: fade, WebkitMaskImage: fade }}
    >
      <svg
        className="absolute left-1/2 top-0 h-full w-[1200px] -translate-x-1/2"
        viewBox="0 0 1200 420"
        fill="none"
        preserveAspectRatio="xMidYMin meet"
      >
        <path d="M120 -1 L600 330 L1080 -1" stroke={line(1)} strokeOpacity={0.45} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <path d="M200 -1 L600 276 L1000 -1" stroke={line(2)} strokeOpacity={0.45} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  )
}
