import type { Span } from "../types/Span";

function Section({ title, value }: { title: string; value: unknown }) {
  if (value === undefined || value === null) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", color: "#888" }}>{title}</div>
      <pre
        style={{
          margin: 0,
          fontSize: 12,
          background: "#f8fafc",
          padding: 8,
          borderRadius: 6,
          overflow: "auto",
        }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export function SpanInspector({ span }: { span: Span | null }) {
  if (!span) return <p style={{ color: "#888", padding: 12 }}>Select a node to inspect.</p>;
  const attrs = (span.attributes ?? {}) as Record<string, unknown>;
  return (
    <div style={{ padding: 12, overflow: "auto" }}>
      <h3 style={{ fontSize: 14, marginTop: 0 }}>{span.name}</h3>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
        {span.kind} · {span.status}
      </div>
      <Section title="Args" value={attrs.args} />
      <Section title="Result" value={attrs.result} />
      <Section title="Tokens / usage" value={attrs.usage ?? attrs.token_usage} />
      <Section title="Error" value={attrs.error} />
    </div>
  );
}
