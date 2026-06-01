/**
 * Linear/Stripe-style scroll progress bar pinned to the top of the viewport.
 *
 * Driven entirely by the browser's native scroll timeline (CSS
 * `animation-timeline: scroll(root)`, see `.scroll-progress-native` in
 * globals.css) — no framer-motion `useScroll` listener, no React state, no
 * main-thread work on scroll. Progressive enhancement: where unsupported the
 * bar stays empty (decorative), and reduced-motion disables it. Pure markup,
 * so it can render as a server component.
 */
export function ScrollProgress() {
  return (
    <div
      aria-hidden
      className="scroll-progress-native fixed inset-x-0 top-0 z-[60] h-[3px] bg-gradient-to-r from-brand-emerald-400 via-brand-emerald-500 to-brand-emerald-600 shadow-[0_1px_6px_-1px_rgba(16,185,129,0.5)]"
    />
  );
}
