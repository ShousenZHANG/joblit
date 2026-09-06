import { useId } from "react";

/** Static first-paint artwork. Inherited tokens apply the theme before hydration. */
export function WorkstationPoster({ className }: { className?: string }) {
  const id = useId();
  const paper = `${id}-paper`;
  const panel = `${id}-panel`;

  return (
    <svg viewBox="0 0 800 740" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={paper} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop stopColor="#f2f6fc" />
          <stop offset="1" stopColor="#d4dfed" />
        </linearGradient>
        <linearGradient id={panel} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop stopColor="var(--experience-raised, #f4f7fc)" />
          <stop offset="1" stopColor="var(--experience-surface, #e8eef7)" />
        </linearGradient>
      </defs>

      <g transform="translate(126 454) rotate(3 110 65)" opacity=".72">
        <rect x="4" y="6" width="222" height="127" rx="11" fill="var(--experience-line, #bac8da)" />
        <rect width="222" height="127" rx="11" fill={`url(#${panel})`} stroke="var(--experience-line, #bac8da)" />
        <text x="21" y="36" fill="var(--experience-text, #172338)" fontFamily="sans-serif" fontSize="16" fontWeight="600">Data Analyst</text>
        <text x="21" y="59" fill="var(--experience-muted, #64748b)" fontFamily="sans-serif" fontSize="11">Melbourne, Australia</text>
        <path d="M21 78h177" stroke="var(--experience-line, #bac8da)" />
        <text x="21" y="103" fill="var(--experience-muted, #64748b)" fontFamily="sans-serif" fontSize="11">SQL · Python · Insights</text>
      </g>

      <path d="M335 424C361 455 378 430 388 369" stroke="var(--experience-green, #059669)" strokeWidth="1.5" strokeOpacity=".55" />
      <circle cx="367.5" cy="431" r="3" fill="var(--experience-green, #059669)" />

      <g transform="translate(390 140) rotate(3 134 190)">
        <rect x="6" y="8" width="268" height="380" rx="7" fill="#95a7c0" />
        <rect width="268" height="380" rx="7" fill={`url(#${paper})`} stroke="#b3c2d6" />
        <rect x="25" y="27" width="30" height="30" rx="7" fill="#14223a" />
        <text x="34" y="49" fill="#34d399" fontFamily="sans-serif" fontSize="21" fontWeight="600">J</text>
        <text x="69" y="40" fill="#425976" fontFamily="sans-serif" fontSize="8" fontWeight="600">JOBLIT / APPLICATION STUDIO</text>
        <text x="25" y="94" fill="#243651" fontFamily="sans-serif" fontSize="24" fontWeight="600">ALEX MORGAN</text>
        <text x="25" y="116" fill="#425976" fontFamily="sans-serif" fontSize="10" fontWeight="600">SOFTWARE ENGINEER</text>
        <path d="M25 134h217" stroke="#91a3bd" strokeOpacity=".5" />
        <text x="25" y="160" fill="#425976" fontFamily="sans-serif" fontSize="8" fontWeight="600">PROFILE</text>
        <text x="25" y="223" fill="#425976" fontFamily="sans-serif" fontSize="8" fontWeight="600">SELECTED EXPERIENCE</text>
        {[174, 186, 198, 240, 252, 264, 276, 324, 336].map((y, i) => (
          <rect
            key={y}
            x="25"
            y={y}
            width={i % 3 === 2 ? 155 : 217}
            height="4"
            rx="2"
            fill="#7b90ae"
            opacity=".7"
          />
        ))}
        <text x="25" y="307" fill="#425976" fontFamily="sans-serif" fontSize="8" fontWeight="600">TOOLS &amp; TECHNOLOGIES</text>
        <path d="M17 235v45" stroke="#059669" strokeWidth="2" />
        <text x="25" y="361" fill="#657895" fontFamily="sans-serif" fontSize="7">ILLUSTRATIVE DOCUMENT</text>
      </g>

      <g transform="translate(89 267) rotate(-4 140 80)">
        <rect x="4" y="6" width="280" height="164" rx="12" fill="var(--experience-line, #bac8da)" />
        <rect width="280" height="164" rx="12" fill={`url(#${panel})`} stroke="var(--experience-line, #bac8da)" />
        <text x="22" y="31" fill="var(--experience-muted, #64748b)" fontFamily="sans-serif" fontSize="9" fontWeight="600">SAMPLE ROLE / AUSTRALIA</text>
        <text x="22" y="64" fill="var(--experience-text, #172338)" fontFamily="sans-serif" fontSize="19" fontWeight="600">Software Engineer</text>
        <text x="22" y="89" fill="var(--experience-muted, #64748b)" fontFamily="sans-serif" fontSize="12">Sydney, NSW · Full time</text>
        <path d="M22 108h236" stroke="var(--experience-line, #bac8da)" />
        <rect x="22" y="124" width="92" height="23" rx="5" fill="var(--experience-raised, #f4f7fc)" stroke="var(--experience-line, #bac8da)" />
        <text x="32" y="140" fill="var(--experience-green, #059669)" fontFamily="sans-serif" fontSize="11">TypeScript</text>
        <rect x="124" y="124" width="61" height="23" rx="5" fill="var(--experience-raised, #f4f7fc)" stroke="var(--experience-line, #bac8da)" />
        <text x="136" y="140" fill="var(--experience-green, #059669)" fontFamily="sans-serif" fontSize="11">React</text>
      </g>
    </svg>
  );
}
