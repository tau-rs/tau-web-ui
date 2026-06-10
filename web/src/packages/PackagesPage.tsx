import { useEffect, useState } from "react";
import type { Package } from "../types/Package";
import {
  getPackages,
  installPackage,
  uninstallPackage,
  updatePackage,
  resolvePackages,
  verifyPackages,
} from "../api/config";

export function PackagesPage() {
  const [pkgs, setPkgs] = useState<Package[]>([]);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Record<string, string>>({});

  const reload = () =>
    getPackages()
      .then(setPkgs)
      .catch(() => {});
  useEffect(() => {
    reload();
  }, []);

  async function onInstall() {
    if (!url.trim()) return;
    await installPackage(url).catch(() => {});
    setUrl("");
    reload();
  }
  async function onVerify() {
    const results = await verifyPackages().catch(() => []);
    setStatus(Object.fromEntries(results.map((r) => [r.name, r.status])));
  }

  const btn = "rounded-md px-2.5 py-1 text-xs font-medium";
  const ghost = `${btn} border border-border text-muted hover:text-fg`;
  const input = "rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs";

  return (
    <div className="space-y-3 p-4">
      <h2 className="text-base font-semibold">Packages</h2>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3">
        <input
          aria-label="install git url"
          placeholder="https://github.com/org/tool.git"
          className={`min-w-0 flex-1 ${input}`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button onClick={onInstall} className={`${btn} bg-accent text-accent-fg`}>
          Install
        </button>
        <button
          onClick={() =>
            resolvePackages()
              .then(setPkgs)
              .catch(() => {})
          }
          className={ghost}
        >
          Resolve
        </button>
        <button onClick={onVerify} className={ghost}>
          Verify
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="px-3 py-2 font-medium">package</th>
              <th className="px-3 py-2 font-medium">version</th>
              <th className="px-3 py-2 font-medium">source</th>
              <th className="px-3 py-2 font-medium">scope</th>
              <th className="px-3 py-2 font-medium">versions</th>
              <th className="px-3 py-2 font-medium">status</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {pkgs.map((p) => (
              <tr key={p.name} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2 font-medium">{p.name}</td>
                <td className="px-3 py-2 font-mono text-muted">{p.version}</td>
                <td className="px-3 py-2 font-mono text-muted">{p.source}</td>
                <td className="px-3 py-2 text-muted">{p.scope}</td>
                <td className="px-3 py-2 font-mono text-muted">{p.version_count}</td>
                <td className="px-3 py-2">
                  <span className="rounded bg-st-ok-soft px-1.5 py-0.5 text-[10px] font-medium text-st-ok">
                    {status[p.name] ?? "—"}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="flex gap-2">
                    <button
                      onClick={() =>
                        updatePackage(p.name)
                          .then(reload)
                          .catch(() => {})
                      }
                      className={ghost}
                    >
                      update
                    </button>
                    <button
                      onClick={() =>
                        uninstallPackage(p.name)
                          .then(reload)
                          .catch(() => {})
                      }
                      className={ghost}
                    >
                      uninstall
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
