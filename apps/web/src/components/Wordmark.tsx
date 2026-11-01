// Skimjob's own hand-lettered wordmark: lower-case "skimjob" in Pangolin, the
// i's dot swapped for a gold coin, a domino-mask mark and a pencil swoosh.
export function MaskMark({ size = 34 }: { size?: number }) {
  return (
    <svg className="wm-mark" width={size} height={size * 0.62} viewBox="0 0 52 32" aria-hidden="true">
      <path
        d="M4.5 9.5C11 4.8 20 6 26 9.6c6-3.6 15-4.8 21.5-.1 2.6 7.6-.4 16.6-8.6 17.6-5.5.6-9.6-3.6-12.9-3.9-3.3.3-7.4 4.5-12.9 3.9C4.9 26.1 1.9 17.1 4.5 9.5z"
        transform="translate(1.2 1.4)"
        fill="#2a23202e"
      />
      <path
        d="M4.5 9.5C11 4.8 20 6 26 9.6c6-3.6 15-4.8 21.5-.1 2.6 7.6-.4 16.6-8.6 17.6-5.5.6-9.6-3.6-12.9-3.9-3.3.3-7.4 4.5-12.9 3.9C4.9 26.1 1.9 17.1 4.5 9.5z"
        fill="var(--clay)"
        stroke="var(--ink)"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path d="M10.5 14.6c2.6-2.2 6.6-2.2 8.6.5-1.8 2.8-6.4 2.9-8.6-.5zM41.5 14.6c-2.6-2.2-6.6-2.2-8.6.5 1.8 2.8 6.4 2.9 8.6-.5z" fill="var(--ink)" />
      <path d="M9 10.2c3-1.6 6.4-1.8 9-.6" fill="none" stroke="#fff7ee" strokeOpacity=".55" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ size = 34 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }} aria-label="Skimjob" role="img">
      <MaskMark size={size * 1.05} />
      <span className="wm-text" aria-hidden="true">
        sk
        <span className="wm-i">
          ı
          <svg className="wm-coin" viewBox="0 0 20 20">
            <circle cx="10.8" cy="11" r="7.4" fill="#2a232030" />
            <circle cx="10" cy="10" r="7.4" fill="var(--gold)" stroke="var(--ink)" strokeWidth="2" />
            <path d="M7.2 7.6c1.2-1 2.6-1.3 3.9-1" fill="none" stroke="#fff7ee" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
        mjob
        <svg className="wm-swoosh" viewBox="0 0 120 12" preserveAspectRatio="none">
          <path d="M2 8.5C30 5.2 64 4.2 96 5.6c8 .4 14 1.1 21 2.3" fill="none" stroke="var(--clay)" strokeWidth="3" strokeLinecap="round" />
          <path d="M70 9.6c12-.5 24-.1 34 .9" fill="none" stroke="var(--clay)" strokeWidth="1.6" strokeLinecap="round" opacity=".7" />
        </svg>
      </span>
    </span>
  );
}
