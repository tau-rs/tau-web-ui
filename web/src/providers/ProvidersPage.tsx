import { useEffect, useState } from "react";
import type { Provider } from "../types/Provider";
import { getProviders } from "../api/providers";
import { installPackage } from "../api/config";

export function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [url, setUrl] = useState("");

  const reload = () =>
    getProviders()
      .then(setProviders)
      .catch(() => {});
  useEffect(() => {
    reload();
  }, []);

  async function onAdd() {
    if (!url.trim()) return;
    await installPackage(url).catch(() => {});
    setUrl("");
    reload();
  }

  const btn = "rounded-md px-2.5 py-1 text-xs font-medium";
  const input = "rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs";
  const badge = "rounded px-1.5 py-0.5 text-[10px] font-medium";

  return (
    <div className="space-y-3 p-4">
      <h2 className="text-base font-semibold">Providers</h2>
      <p className="max-w-2xl text-xs text-muted">
        LLM backends available to this project&apos;s agents. The <b>recommended</b> one is the
        most-used backend across your agents. A fully custom backend can also just be typed into an
        agent&apos;s provider field.
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
              <th className="px-3 py-2 font-medium">credentials</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.name} className="border-b border-border/60 last:border-0">
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
                  {/* Gated until tau β.5 credentials chain; p.credentials_gated unused for now. */}
                  <button
                    type="button"
                    disabled
                    title="waits on tau β.5"
                    className={`${badge} cursor-not-allowed bg-amber-100 font-semibold text-amber-800 opacity-80`}
                  >
                    🔒 Set API key
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
