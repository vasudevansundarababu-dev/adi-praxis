'use client';

/**
 * D13 (owner, 15 Nov 2026): Help is a small floating mascot, our own ADI Forge character "Ember": a friendly
 * flame-like forge ember with a face, in the ADI Forge purples with a teal spark (docs/design/brand-forge). Inline SVG (no
 * downloads), a gentle idle bob that stops under prefers-reduced-motion, a "Need help?" bubble on hover or focus,
 * keyboard reachable with a focus ring, hidden in print. Fixed bottom-right, above the sticky Save bar.
 */
export function EmberMark({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ember-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#B49CF5" />
          <stop offset="0.55" stopColor="#8B6CF0" />
          <stop offset="1" stopColor="#5B4BD6" />
        </linearGradient>
      </defs>
      {/* a soft glow it floats over */}
      <ellipse cx="32" cy="56" rx="13" ry="3.5" fill="#8B6CF0" opacity="0.35" />
      {/* the ember: a rounded flame with a curled tip */}
      <path d="M32 6c3 7 13 12 13 25 0 9-6 17-13 17S19 40 19 31c0-7 4-11 7-14 0 4 2 6 4 6-1-6 0-12 2-17z" fill="url(#ember-body)" />
      {/* face */}
      <ellipse cx="27" cy="32" rx="3.2" ry="3.8" fill="#FFFFFF" />
      <ellipse cx="37" cy="32" rx="3.2" ry="3.8" fill="#FFFFFF" />
      <circle cx="27.8" cy="32.8" r="1.7" fill="#1E1B4B" />
      <circle cx="37.8" cy="32.8" r="1.7" fill="#1E1B4B" />
      <circle cx="28.4" cy="32" r="0.6" fill="#FFFFFF" />
      <circle cx="38.4" cy="32" r="0.6" fill="#FFFFFF" />
      <path d="M28.5 39.5c2 2 5 2 7 0" stroke="#1E1B4B" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <circle cx="23.5" cy="37.5" r="1.8" fill="#F0A6CA" opacity="0.8" />
      <circle cx="40.5" cy="37.5" r="1.8" fill="#F0A6CA" opacity="0.8" />
      {/* a little teal spark it's proud of */}
      <path d="M50 14l1.4 3.6L55 19l-3.6 1.4L50 24l-1.4-3.6L45 19l3.6-1.4z" fill="#3FAC95" />
      <circle cx="13" cy="22" r="1.6" fill="#3FAC95" opacity="0.7" />
    </svg>
  );
}

export function HelpMascot({ onOpen }: { onOpen: () => void }) {
  return (
    <>
      <style>{`
        @keyframes ember-bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
        .ember-bob { animation: ember-bob 2.8s ease-in-out infinite }
        @media (prefers-reduced-motion: reduce) { .ember-bob { animation: none } }
        .ember-help:hover .ember-bubble, .ember-help:focus-visible .ember-bubble { opacity: 1; transform: translateY(0) }
      `}</style>
      <button
        type="button"
        data-help-fab
        aria-label="Help"
        onClick={onOpen}
        className="ember-help group fixed bottom-20 right-3 z-40 rounded-full p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link sm:bottom-24 sm:right-6 print:hidden"
      >
        <span className="ember-bubble pointer-events-none absolute -top-9 right-1 translate-y-1 whitespace-nowrap rounded-xl border border-line bg-surface px-3 py-1 text-xs font-semibold text-fg opacity-0 shadow-md transition">
          Need help?
        </span>
        <span className="ember-bob block drop-shadow-lg">
          <EmberMark size={64} />
        </span>
      </button>
    </>
  );
}
