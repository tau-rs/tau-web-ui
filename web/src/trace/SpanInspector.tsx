import type { Span } from "../types/Span";

function Section({ title, value }: { title: string; value: unknown }) {
  if (value === undefined || value === null) return null;
  return (
    <div className="mb-2.5">
      <div className="text-[11px] uppercase text-muted">{title}</div>
      <pre className="m-0 overflow-auto rounded-md bg-bg p-2 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export function SpanInspector({ span, workflow }: { span: Span | null; workflow?: boolean }) {
  if (!span) return <p className="p-3 text-sm text-muted">Select a node to inspect.</p>;
  const attrs = (span.attributes ?? {}) as Record<string, unknown>;
  const showDrill = workflow && span.kind === "agent";
  return (
    <div className="overflow-auto p-3">
      <h3 className="mb-1 mt-0 text-sm font-semibold">{span.name}</h3>
      <div className="mb-2 text-xs text-muted">
        {span.kind} · {span.status}
      </div>
      <Section title="Input" value={attrs.input} />
      <Section title="Output" value={attrs.output} />
      <Section title="Args" value={attrs.args} />
      <Section title="Result" value={attrs.result} />
      <Section title="Tokens / usage" value={attrs.usage ?? attrs.token_usage} />
      <Section title="Error" value={attrs.error} />
      {showDrill && (
        <button
          disabled
          title="tau doesn't link a workflow step to the agent's run yet"
          className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted"
        >
          ↗ view agent trace
          <span className="rounded bg-amber-100 px-1 text-[9px] font-bold uppercase text-amber-800">
            gated
          </span>
        </button>
      )}
    </div>
  );
}
