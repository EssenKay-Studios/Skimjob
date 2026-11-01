// Landing illustration: our own toy bank in a 3/4 view, cel-shaded with a
// warm-ink outline (ui-style §7), its door left ajar, a masked crew member
// sneaking off with the loot. Placeholder until the M2-9 art lands.
export function BankDoodle({ className }: { className?: string }) {
  const ink = "#3a2a22";
  const line = { stroke: ink, strokeWidth: 2.2, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  return (
    <svg className={className} viewBox="0 0 480 360" role="img" aria-label="A little bank with its door ajar and a masked robber carrying a sack of loot">
      <defs>
        <filter id="bd-wobble" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="11" />
          <feDisplacementMap in="SourceGraphic" scale="3.2" />
        </filter>
        <radialGradient id="bd-glow" cx="0.5" cy="1" r="0.9">
          <stop offset="0" stopColor="#ffd98a" />
          <stop offset="1" stopColor="#f4c76a" />
        </radialGradient>
      </defs>

      {/* Plinth */}
      <ellipse cx="244" cy="322" rx="214" ry="30" fill="#e3cba8" />
      <ellipse cx="240" cy="318" rx="214" ry="30" fill="var(--plinth)" />
      <path d="M48 312c40-14 110-20 190-20" fill="none" stroke="#fffdf8" strokeOpacity=".55" strokeWidth="3" strokeLinecap="round" />

      <g filter="url(#bd-wobble)">
        {/* Hatched shadow on the plinth */}
        <path d="M118 306 L388 306 L430 286 L380 270 L150 286 Z" fill="url(#sk-hatch)" opacity=".55" />

        {/* Steps */}
        <path d="M84 302h272v14H84z" fill="#c9bba5" {...line} />
        <path d="M356 302l30-16v14l-30 16z" fill="#a8977d" {...line} />
        <path d="M96 290h248v12H96z" fill="#d8ccb7" {...line} />
        <path d="M344 290l30-16v12l-30 16z" fill="#b4a590" {...line} />

        {/* Side wall (shade) */}
        <path d="M330 150l40-21v140l-40 21z" fill="#d7bc8f" {...line} />
        <path d="M341 178l18-9v26l-18 9zM341 230l18-9v26l-18 9z" fill="#f4c76a" {...line} strokeWidth={1.8} />
        <path d="M341 178l18-9v8l-18 9z" fill="#3a2a2224" />
        <path d="M341 230l18-9v8l-18 9z" fill="#3a2a2224" />

        {/* Front wall */}
        <path d="M110 150h220v140H110z" fill="#efe6d6" {...line} />
        <path d="M110 150h220v10H110z" fill="#dccbae" />

        {/* Windows */}
        {[150, 270].map((x) => (
          <g key={x}>
            <path d={`M${x} 214v-30c0-7 4-11 10-11s10 4 10 11v30z`} fill="#f4c76a" {...line} strokeWidth={1.8} />
            <path d={`M${x} 184c0-7 4-11 10-11s10 4 10 11z`} fill="#e2a94a" opacity=".55" />
            <path d={`M${x + 10} 174v40M${x} 194h20`} stroke={ink} strokeWidth="1.5" />
          </g>
        ))}

        {/* Door, ajar, light spilling out */}
        <path d="M200 290v-52c0-13 9-22 20-22s20 9 20 22v52z" fill="url(#bd-glow)" {...line} />
        <path d="M200 290v-52c0-9 4-16 10-19l8 4v67z" fill="#7a4a35" {...line} strokeWidth={1.9} />
        <circle cx="213" cy="258" r="1.9" fill="var(--gold)" stroke={ink} strokeWidth="1" />
        <path d="M218 290l26 12h-44z" fill="#ffd98a" opacity=".7" />

        {/* Columns */}
        {[135, 185, 255, 305].map((x) => (
          <g key={x}>
            <path d={`M${x - 11} 158h22v126h-22z`} fill="#f7f1e6" {...line} strokeWidth={1.9} />
            <path d={`M${x + 3} 159h7v124h-7z`} fill="#dccbae" />
            <path d={`M${x - 4} 162v118`} stroke={ink} strokeOpacity=".22" strokeWidth="1.3" />
            <path d={`M${x - 15} 150h30v8h-30zM${x - 15} 284h30v6h-30z`} fill="#e5d7bf" {...line} strokeWidth={1.9} />
          </g>
        ))}

        {/* Frieze with the sign */}
        <path d="M100 130h238v20H100z" fill="#e5c697" {...line} />
        <path d="M338 130l42-22v20l-42 22z" fill="#c9a774" {...line} />
        <text x="219" y="145.5" textAnchor="middle" fontFamily="Pangolin, cursive" fontWeight="700" fontSize="15" letterSpacing="6" fill={ink}>
          BANK
        </text>

        {/* Pediment and roof */}
        <path d="M220 76l166 32-48 22H92z" fill="#d0623f" {...line} />
        <path d="M220 76l166 32-48 22z" fill="#b4512f" opacity=".55" />
        <path d="M92 130l128-54 118 54z" fill="#efe1c6" {...line} />
        <path d="M128 122l92-38 84 38z" fill="#e0cba4" {...line} strokeWidth={1.6} />
        <circle cx="220" cy="108" r="8" fill="var(--gold)" {...line} strokeWidth={1.8} />
        <path d="M220 103.5v9M217 106h4.2a1.7 1.7 0 010 3.4H218" fill="none" stroke={ink} strokeWidth="1.3" />

        {/* Flag on the apex */}
        <path d="M220 76V44" {...line} fill="none" />
        <path d="M221 45c8-4 14 3 24-1v14c-10 4-16-3-24 1z" fill="var(--clay)" {...line} strokeWidth={1.9} />

        {/* Sack of loot */}
        <path d="M384 300c-14-2-20-16-14-30 5-12 16-18 18-24l-6-6 10-2 4 5 9-5 4 9-6 4c4 7 14 13 16 25 3 16-10 27-35 24z" fill="#c9a26b" {...line} />
        <path d="M388 246c4 3 9 3 13 0" fill="none" stroke={ink} strokeWidth="1.6" strokeLinecap="round" />
        <path d="M396 266c-5-3-11 0-9 5s10 3 9 8-8 5-11 2M391 262v26" fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" />
        <path d="M376 276c2-8 6-12 10-16" fill="none" stroke="#fffdf8" strokeOpacity=".45" strokeWidth="2.4" strokeLinecap="round" />
        {[
          [428, 304],
          [446, 296],
          [418, 314],
        ].map(([x, y], i) => (
          <g key={i}>
            <ellipse cx={x} cy={y} rx="8" ry="4.6" fill="#c99a38" {...line} strokeWidth={1.6} />
            <ellipse cx={x} cy={y! - 2} rx="8" ry="4.6" fill="var(--gold)" {...line} strokeWidth={1.6} />
          </g>
        ))}

        {/* Crew member tiptoeing away */}
        <g transform="translate(58 222) rotate(-6)">
          <path d="M8 92l-6 10h14zM30 92l2 10h14z" fill="#2b2449" {...line} strokeWidth={1.8} />
          <rect x="2" y="30" width="38" height="66" rx="17" fill="#3d5a80" {...line} />
          <path d="M28 34c6 6 8 24 8 40" fill="none" stroke="#2c4566" strokeWidth="6" strokeLinecap="round" opacity=".55" />
          <circle cx="21" cy="20" r="17" fill="#e9c39b" {...line} />
          <path d="M5 18c4-4 28-4 32 0v8c-4 3-28 3-32 0z" fill="#2a2320" />
          <ellipse cx="14" cy="21.5" rx="3.2" ry="2.6" fill="#fffdf8" />
          <ellipse cx="28" cy="21.5" rx="3.2" ry="2.6" fill="#fffdf8" />
          <circle cx="15" cy="22" r="1.4" fill="#2a2320" />
          <circle cx="29" cy="22" r="1.4" fill="#2a2320" />
          <path d="M5 13c1-12 31-13 32 0z" fill="var(--clay)" {...line} strokeWidth={1.9} />
          <circle cx="21" cy="1" r="4" fill="var(--clay)" {...line} strokeWidth={1.6} />
          <path d="M38 52c10-2 16 4 20 10" fill="none" {...line} stroke={ink} strokeWidth={6.5} />
          <path d="M38 52c10-2 16 4 20 10" fill="none" stroke="#3d5a80" strokeWidth="3.4" strokeLinecap="round" />
        </g>
        {/* Little sack in hand */}
        <path d="M118 286c-10 0-14-9-10-17 3-6 9-9 9-13l6-1 4 5c5 4 9 8 9 14 0 8-8 12-18 12z" fill="#c9a26b" {...line} strokeWidth={1.9} />
        <path d="M120 266v14" stroke={ink} strokeWidth="1.6" strokeLinecap="round" />

        {/* Motion ticks */}
        <path d="M30 256h12M24 270h14M32 284h8" stroke={ink} strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  );
}
