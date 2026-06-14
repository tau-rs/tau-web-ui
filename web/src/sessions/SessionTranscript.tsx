import type { ReactNode } from "react";
import type { SessionDetail } from "../types/SessionDetail";
import type { TurnSummary } from "../types/TurnSummary";

/** Best-effort field pluck from an opaque message value. tau's Message shape is not
 *  a documented contract (see spec), so we probe common shapes and fall back to JSON. */
function field(m: unknown, ...keys: string[]): string | undefined {
  if (m && typeof m === "object") {
    const obj = m as Record<string, unknown>;
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "string") return v;
    }
  }
  return undefined;
}

function messageText(m: unknown): string | undefined {
  if (m && typeof m === "object") {
    const payload = (m as Record<string, unknown>).payload;
    const nested = field(payload, "text");
    if (nested) return nested;
  }
  return field(m, "text", "content");
}

function roleOf(m: unknown): string {
  return field(m, "role", "from") ?? "message";
}

function Bubble({ role, children }: { role: string; children: ReactNode }) {
  const isUser = role === "user";
  return (
    <div
      className={`max-w-[78%] rounded-lg border px-3 py-2 text-sm ${
        isUser
          ? "self-end border-accent/25 bg-accent/[0.08]"
          : "self-start border-border bg-surface"
      }`}
    >
      <div className="mb-0.5 text-[9px] uppercase tracking-wide text-muted">{role}</div>
      {children}
    </div>
  );
}

function Divider({ t }: { t: TurnSummary }) {
  const inTok = t.input_tokens != null ? Number(t.input_tokens) : null;
  const outTok = t.output_tokens != null ? Number(t.output_tokens) : null;
  const toks = inTok != null || outTok != null ? ` · ${inTok ?? 0} in / ${outTok ?? 0} out` : "";
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="h-px flex-1 bg-border" />
      <span className="font-mono text-[10px] text-muted">
        turn {t.turn} · {t.stop_reason}
        {toks}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

export function SessionTranscript({ detail }: { detail: SessionDetail }) {
  // v1 ordering: render all messages, then each turn divider after its turn index.
  // The data needed for exact interleave is present; full fidelity is a follow-up.
  return (
    <div className="flex flex-col gap-2.5">
      {detail.messages.map((m, i) => {
        const text = messageText(m);
        return (
          <Bubble key={`m${i}`} role={roleOf(m)}>
            {text != null ? (
              <span>{text}</span>
            ) : (
              <pre className="m-0 overflow-auto whitespace-pre-wrap text-[11px] text-muted">
                {JSON.stringify(m, null, 2)}
              </pre>
            )}
          </Bubble>
        );
      })}
      {detail.turn_summaries.map((t) => (
        <Divider key={`t${t.turn}`} t={t} />
      ))}
    </div>
  );
}
