import { useState } from "react";
import type { BackendCredentialStatus } from "../types/BackendCredentialStatus";
import type { SourceConfig } from "../types/SourceConfig";
import type { SourceKind } from "../types/SourceKind";
import { putCredential } from "../api/credentials";

const KIND_LABEL: Record<SourceKind, string> = {
  env: "Env",
  local: "Local",
  vault: "Vault",
  aws_kv: "AWS KV",
  gcp_kv: "GCP KV",
  azure_kv: "Azure KV",
  token_broker: "Token broker",
  workload_identity: "Workload identity",
};
const ADDABLE_KINDS: SourceKind[] = ["env", "local", "vault", "aws_kv", "gcp_kv", "azure_kv"];
const GATED_KINDS: SourceKind[] = ["token_broker", "workload_identity"];
const KIND_PLACEHOLDER: Partial<Record<SourceKind, string>> = {
  env: "ANTHROPIC_API_KEY",
  vault: "secret/data/anthropic",
  aws_kv: "prod/anthropic-key",
  gcp_kv: "projects/PROJECT/secrets/anthropic",
  azure_kv: "anthropic",
};

interface Row {
  kind: SourceKind;
  ref: string;
}

export function CredentialChainEditor({
  backend,
  status,
  onSaved,
}: {
  backend: string;
  status?: BackendCredentialStatus;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    (status?.sources ?? []).map((s) => ({ kind: s.kind, ref: s.ref ?? "" })),
  );
  const [localValue, setLocalValue] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const hasLocal = rows.some((r) => r.kind === "local");
  const used = new Set(rows.map((r) => r.kind));
  const statusByKind = new Map((status?.sources ?? []).map((s) => [s.kind, s]));

  const add = (kind: SourceKind) => setRows((rs) => [...rs, { kind, ref: "" }]);
  const remove = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  const setRef = (i: number, ref: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ref } : r)));
  const move = (i: number, dir: -1 | 1) =>
    setRows((rs) => {
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  async function save() {
    if (saving) return;
    setError("");
    setSaving(true);
    const sources: SourceConfig[] = rows.map((r) => ({
      kind: r.kind,
      ref: r.kind === "local" ? null : r.ref,
    }));
    try {
      await putCredential(backend, {
        sources,
        ...(hasLocal && localValue ? { local_value: localValue } : {}),
      });
      setLocalValue("");
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  const chip = "rounded border px-1.5 py-0.5 text-[10px]";
  const field = "rounded border border-border bg-surface px-1.5 py-0.5 text-[11px]";

  return (
    <div className="rounded-md border border-accent/30 bg-accent/5 p-3">
      <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-accent">
        credential chain — {backend}
      </div>

      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={`${r.kind}-${i}`} className="flex items-center gap-2">
            <div className="flex flex-col">
              <button
                type="button"
                aria-label={`move ${KIND_LABEL[r.kind]} up`}
                onClick={() => move(i, -1)}
                className="text-[8px] text-muted hover:text-fg"
              >
                ▲
              </button>
              <button
                type="button"
                aria-label={`move ${KIND_LABEL[r.kind]} down`}
                onClick={() => move(i, 1)}
                className="text-[8px] text-muted hover:text-fg"
              >
                ▼
              </button>
            </div>
            <span className={`${chip} border-accent/40 text-accent`}>{KIND_LABEL[r.kind]}</span>
            {r.kind === "local" ? (
              <span className="flex-1 text-[10px] text-muted">resolves from the local store</span>
            ) : (
              <input
                aria-label={`${KIND_LABEL[r.kind]} ref ${i}`}
                placeholder={KIND_PLACEHOLDER[r.kind]}
                value={r.ref}
                onChange={(e) => setRef(i, e.target.value)}
                className={`flex-1 font-mono ${field}`}
              />
            )}
            {(() => {
              const st = statusByKind.get(r.kind);
              return st && !st.configured && st.detail ? (
                <span className="flex-none text-[9px] text-amber-700">⚠ {st.detail}</span>
              ) : null;
            })()}
            <button
              type="button"
              aria-label={`remove ${KIND_LABEL[r.kind]}`}
              onClick={() => remove(i)}
              className="text-xs text-muted hover:text-st-error"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {hasLocal && (
        <div className="mt-2">
          <label className="block text-[10px] text-muted">
            local secret value (write-only)
            <input
              type="password"
              aria-label="local secret value"
              placeholder={
                status?.sources.some((s) => s.kind === "local" && s.configured)
                  ? "•••••• (set — type to replace)"
                  : "paste the key"
              }
              value={localValue}
              onChange={(e) => setLocalValue(e.target.value)}
              className={`mt-0.5 w-full font-mono ${field}`}
            />
          </label>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="text-[9px] uppercase text-muted">add source</span>
        {ADDABLE_KINDS.filter((k) => !used.has(k)).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => add(k)}
            className="rounded border border-accent/40 px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/10"
          >
            {KIND_LABEL[k]}
          </button>
        ))}
        {GATED_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            disabled
            aria-label={KIND_LABEL[k]}
            title="waits on CR-2 / CR-3"
            className="cursor-not-allowed rounded border border-border px-1.5 py-0.5 text-[10px] text-muted opacity-60"
          >
            <span aria-hidden="true">🔒 </span>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {error && <div className="mt-2 text-[10px] text-st-error">{error}</div>}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-fg disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {status &&
          (status.resolved ? (
            <span className="text-[10px] text-st-ok">✓ resolves via {status.resolved_via}</span>
          ) : (
            <span className="text-[10px] text-muted">🔒 unresolved</span>
          ))}
      </div>
    </div>
  );
}
