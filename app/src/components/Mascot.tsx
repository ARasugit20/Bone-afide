// "Bo", the Bonafide pup — an original, minimal mascot. `animated` wiggles the ears and bobs the head.
export function Mascot({ className = "h-10 w-10", animated = false, title }: { className?: string; animated?: boolean; title?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={`${className} ${animated ? "mascot-bob" : ""}`}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path className={animated ? "mascot-ear-l" : ""} d="M15 17C7 19 4 33 8 42c2.5 5 8.5 3.5 10-2l3-19z" fill="#b9572f" />
      <path className={animated ? "mascot-ear-r" : ""} d="M49 17c8 2 11 16 7 25-2.5 5-8.5 3.5-10-2l-3-19z" fill="#b9572f" />
      <path d="M32 11c13 0 19 10 19 22 0 13-8.5 21-19 21S13 46 13 33c0-12 6-22 19-22z" fill="#f2b07b" />
      <ellipse cx="24" cy="30" rx="6.5" ry="7.2" fill="#e58f5c" />
      <ellipse cx="32" cy="42" rx="11.5" ry="8.8" fill="#fde6cf" />
      <circle cx="19.5" cy="41" r="2.6" fill="#f4a29b" opacity=".55" />
      <circle cx="44.5" cy="41" r="2.6" fill="#f4a29b" opacity=".55" />
      <circle cx="24.5" cy="31" r="2.7" fill="#2f2420" />
      <circle cx="39.5" cy="31" r="2.7" fill="#2f2420" />
      <circle cx="25.5" cy="30" r=".9" fill="#fff" />
      <circle cx="40.5" cy="30" r=".9" fill="#fff" />
      <ellipse cx="32" cy="38.6" rx="3.7" ry="2.7" fill="#2f2420" />
      <path d="M31.2 45.2q.8 4.4 1.6 0z" fill="#e7787f" stroke="#e7787f" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M27.5 43q4.5 3.6 9 0" fill="none" stroke="#2f2420" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
