export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <svg aria-hidden viewBox="0 0 20 20" className="size-5">
        <rect width="20" height="20" rx="5" fill="var(--foreground)" />
        <path d="M5.5 6l4.5 8.5L14.5 6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Vistoo
    </span>
  );
}
