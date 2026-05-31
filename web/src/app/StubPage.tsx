export function StubPage({
  title,
  subtitle,
  gated,
}: {
  title: string;
  subtitle: string;
  gated?: string;
}) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="rounded-lg border border-border bg-surface px-8 py-10 text-center">
        <div className="flex items-center justify-center gap-2">
          <h2 className="text-base font-semibold">{title}</h2>
          {gated && (
            <span className="rounded bg-amber-100 px-1.5 text-[10px] font-bold uppercase text-amber-800">
              gated
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
        {gated && <p className="mt-1 text-xs text-muted">waits on tau {gated}</p>}
      </div>
    </div>
  );
}
