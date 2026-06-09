import { Fragment, useEffect, useState } from "react";
import type { Provider } from "../types/Provider";
import type { BackendCredentialStatus } from "../types/BackendCredentialStatus";
import { getProviders } from "../api/providers";
import { installPackage } from "../api/config";
import { getCredentials } from "../api/credentials";
import { CredentialChainEditor } from "./CredentialChainEditor";

export function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [creds, setCreds] = useState<Record<string, BackendCredentialStatus>>({});
  const [url, setUrl] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const reloadProviders = () =>
    getProviders()
      .then(setProviders)
      .catch(() => {});
  const reloadCreds = () =>
    getCredentials()
      .then((cs) => setCreds(Object.fromEntries(cs.map((c) => [c.backend, c]))))
      .catch(() => {});
  useEffect(() => {
    reloadProviders();
    reloadCreds();
  }, []);

  async function onAdd() {
    if (!url.trim()) return;
    await installPackage(url).catch(() => {});
    setUrl("");
    reloadProviders();
  }

  const btn = "rounded-md px-2.5 py-1 text-xs font-medium";
  const input = "rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs";
  const badge = "rounded px-1.5 py-0.5 text-[10px] font-medium";

  function credBadge(name: string) {
    const c = creds[name];
    if (c?.resolved) {
      return <span className={`${badge} bg-st-ok-soft text-st-ok`}>✓ via {c.resolved_via}</span>;
    }
    return <span className={`${badge} bg-amber-100 text-amber-800`}>🔒 none</span>;
  }

  return (
    <div className="space-y-3 p-4">
      <h2 className="text-base font-semibold">Providers</h2>
      <p className="max-w-2xl text-xs text-muted">
        LLM backends available to this project&apos;s agents. The <b>recommended</b> one is the
        most-used backend across your agents. Credentials are <b>per machine</b> and resolve through
        an ordered source chain (first that resolves wins).
      </p>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3">
        <input
          aria-label="add provider git url"
          placeholder="https://github.com/org/llm-backend.git"
          className={`min-w-0 flex-1 ${input}`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button onClick={onAdd} className={`${btn} bg-accent text-accent-fg`}>
          Add provider
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="px-3 py-2 font-medium">provider</th>
              <th className="px-3 py-2 font-medium">source</th>
              <th className="px-3 py-2 font-medium">installed</th>
              <th className="px-3 py-2 font-medium">recommended</th>
              <th className="px-3 py-2 font-medium">credential</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <Fragment key={p.name}>
                <tr className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-medium">{p.name}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-muted">{p.source}</td>
                  <td className="px-3 py-2">
                    {p.installed ? (
                      <span className={`${badge} bg-st-ok-soft text-st-ok`}>✓ installed</span>
                    ) : (
                      <span className="text-[10px] text-muted">not installed</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {p.recommended && (
                      <span className={`${badge} bg-st-ok-soft text-st-ok`}>✓ recommended</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      {credBadge(p.name)}
                      <button
                        type="button"
                        onClick={() => setExpanded((cur) => (cur === p.name ? null : p.name))}
                        className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted hover:text-fg"
                      >
                        {expanded === p.name ? "close" : "set credential"}
                      </button>
                    </span>
                  </td>
                </tr>
                {expanded === p.name && (
                  <tr className="border-b border-border/60 bg-accent/5">
                    <td colSpan={5} className="px-3 py-3">
                      <CredentialChainEditor
                        backend={p.name}
                        status={creds[p.name]}
                        onSaved={() => {
                          reloadCreds();
                        }}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
