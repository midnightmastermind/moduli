import React from "react";

/**
 * ModuliLogo
 * - True inline SVG (no <img>)
 * - Wordmark uses `currentColor` so you can style via CSS/color prop
 * - Mark gradient is built-in; you can override via CSS var: `--moduli-mark`
 *
 * Usage:
 *   <ModuliLogo className="h-5 text-sky-300" />
 *   <ModuliLogo style={{ height: 20, color: "#38bdf8" }} />
 */
export default function ModuliLogo({ title = "Moduli", ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1200"
      height="220"
      viewBox="0 0 1200 220"
      role="img"
      aria-label={title}
      {...props}
    >
      <defs>
        <linearGradient id="moduliRibbon" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#34f5e7" />
          <stop offset="45%" stopColor="#3ad2ff" />
          <stop offset="100%" stopColor="#2b4bff" />
        </linearGradient>

        <linearGradient id="moduliEdge" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#0b1b30" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#0b1b30" stopOpacity="0.08" />
        </linearGradient>

        <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow
            dx="0"
            dy="6"
            stdDeviation="6"
            floodColor="#000000"
            floodOpacity="0.18"
          />
        </filter>

        <style>{`
          /* Wordmark uses currentColor so you can set color from React/CSS */
          .word { fill: currentColor; }
          /* Override mark fill via CSS variable if you want (optional):
             .yourClass { --moduli-mark: #38bdf8; } */
          .markFill { fill: var(--moduli-mark, url(#moduliRibbon)); }
          .markEdge { fill: url(#moduliEdge); mix-blend-mode: multiply; opacity: 0.55; }
        `}</style>
      </defs>

      {/* MARK (interlocking ribbon infinity) */}
      <g transform="translate(40,22)" filter="url(#softShadow)">
        <path
          className="markFill"
          d="M170 58
             C130 18, 70 20, 40 58
             C10 95, 18 140, 58 162
             C98 184, 140 170, 170 136
             C185 120, 200 110, 222 110
             C244 110, 260 120, 276 136
             C306 170, 352 184, 392 162
             C432 140, 440 95, 410 58
             C380 20, 320 18, 280 58
             C262 78, 246 90, 222 90
             C198 90, 185 78, 170 58
             Z"
        />
        <path
          className="markFill"
          d="M510 58
             C470 18, 410 20, 380 58
             C350 95, 358 140, 398 162
             C438 184, 484 170, 510 136
             C525 120, 540 110, 562 110
             C584 110, 600 120, 616 136
             C646 170, 692 184, 732 162
             C772 140, 780 95, 750 58
             C720 20, 660 18, 620 58
             C602 78, 586 90, 562 90
             C538 90, 525 78, 510 58
             Z"
        />

        {/* weave shading to suggest interlock */}
        <path
          fill="#000000"
          opacity="0.18"
          d="M222 90
             C246 90, 262 78, 280 58
             C305 30, 345 24, 370 46
             C392 66, 388 100, 360 120
             C332 140, 290 132, 276 116
             C260 98, 244 90, 222 90 Z"
        />
        <path
          fill="#000000"
          opacity="0.18"
          d="M562 90
             C586 90, 602 78, 620 58
             C645 30, 685 24, 710 46
             C732 66, 728 100, 700 120
             C672 140, 630 132, 616 116
             C600 98, 584 90, 562 90 Z"
        />

        {/* subtle edge overlay for depth */}
        <path
          className="markEdge"
          d="M40 58 C10 95, 18 140, 58 162
             C98 184, 140 170, 170 136
             C185 120, 200 110, 222 110
             C244 110, 260 120, 276 136
             C306 170, 352 184, 392 162
             C432 140, 440 95, 410 58
             C380 20, 320 18, 280 58
             C262 78, 246 90, 222 90
             C198 90, 185 78, 170 58
             C130 18, 70 20, 40 58 Z"
        />
        <path
          className="markEdge"
          d="M380 58 C350 95, 358 140, 398 162
             C438 184, 484 170, 510 136
             C525 120, 540 110, 562 110
             C584 110, 600 120, 616 136
             C646 170, 692 184, 732 162
             C772 140, 780 95, 750 58
             C720 20, 660 18, 620 58
             C602 78, 586 90, 562 90
             C538 90, 525 78, 510 58
             C470 18, 410 20, 380 58 Z"
        />
      </g>

      {/* WORDMARK (closer spacing) */}
      <g transform="translate(790,58)">
        <text
          className="word"
          x="0"
          y="96"
          fontFamily="JetBrains Mono, IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
          fontSize="112"
          fontWeight="700"
          letterSpacing="2"
        >
          moduli
        </text>
      </g>
    </svg>
  );
}
