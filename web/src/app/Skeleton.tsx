/** A neutral shimmer block used to compose loading skeletons. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-border/60 ${className}`} aria-hidden />;
}
