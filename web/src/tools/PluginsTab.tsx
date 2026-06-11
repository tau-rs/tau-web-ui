import { useEffect, useState } from "react";
import type { PluginDetail } from "../types/PluginDetail";
import type { ProtocolFrame } from "../types/ProtocolFrame";
import { listPlugins } from "../api/plugins";
import { useProjectId } from "../app/project-context";

export function PluginsTab() {
  const pid = useProjectId();
  const [plugins, setPlugins] = useState<PluginDetail[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    listPlugins(pid)
      .then((p) => {
        setPlugins(p);
        setSelected((cur) => cur ?? p[0]?.name ?? null);
      })
      .catch(() => {});
  }, [pid]);

  const current = plugins.find((p) => p.name === selected) ?? null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
        <span aria-hidden>⚠</span>
        <span>Mock data — gated until tau exposes plugin introspection.</span>
      </div>
      <div className="grid grid-cols-[160px_1fr] gap-3">
        <ul className="space-y-0.5">
          {plugins.map((p) => (
            <li key={p.name}>
              <button
                onClick={() => setSelected(p.name)}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-xs ${
                  p.name === selected ? "bg-accent/10 text-accent" : "text-muted hover:text-fg"
                }`}
              >
                <span className="font-medium">{p.name}</span>
                <PortBadge port={p.port} />
              </button>
            </li>
          ))}
        </ul>
        {current ? (
          <PluginDetailPane plugin={current} />
        ) : (
          <p className="text-xs text-muted">No plugins.</p>
        )}
      </div>
    </div>
  );
}

function PortBadge({ port }: { port: string }) {
  const tone =
    port === "LlmBackend" ? "bg-st-running/15 text-st-running" : "bg-accent/10 text-accent";
  return <span className={`rounded-full px-2 text-[9px] font-semibold ${tone}`}>{port}</span>;
}

function PluginDetailPane({ plugin }: { plugin: PluginDetail }) {
  const d = plugin.describe;
  return (
    <div className="space-y-3 text-xs">
      <section>
        <div className="mb-1 text-[9px] uppercase text-muted">describe</div>
        <div className="space-y-0.5">
          <div>
            port <b>{d.port}</b> · proto v{d.protocol_version} ·{" "}
            <span className="font-mono">{plugin.kind}</span> · binary{" "}
            <span className="font-mono">{plugin.binary}</span>
          </div>
          {d.tool && (
            <div className="font-mono text-muted">
              {d.tool.name}(
              {Object.entries(d.tool.input_schema)
                .map(([k, t]) => `${k}: ${t}`)
                .join(", ")}
              )
            </div>
          )}
          {d.capabilities.map((c) => (
            <div key={c.kind} className="font-mono text-[10px] text-muted">
              {c.kind}{" "}
              {Object.entries(c.fields)
                .filter((e): e is [string, string[]] => e[1] !== undefined)
                .map(([k, v]) => `${k}=[${v.join(", ")}]`)
                .join(" ")}
            </div>
          ))}
        </div>
      </section>
      <section>
        <div className="mb-1 text-[9px] uppercase text-muted">protocol-decode</div>
        <div>
          {plugin.transcript.map((f, i) => (
            <FrameRow key={`${i}-${f.method}`} frame={f} />
          ))}
        </div>
      </section>
    </div>
  );
}

function FrameRow({ frame }: { frame: ProtocolFrame }) {
  const [open, setOpen] = useState(false);
  const out = frame.direction === "out";
  const preview = JSON.stringify(frame.payload);
  return (
    <div className="border-b border-border/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-baseline gap-2 py-1 text-left"
      >
        <span className={`w-3 shrink-0 font-bold ${out ? "text-st-running" : "text-st-ok"}`}>
          {out ? "→" : "←"}
        </span>
        <span className="w-32 shrink-0 font-mono font-semibold text-accent">{frame.method}</span>
        <span className="truncate font-mono text-[10px] text-muted">{preview}</span>
      </button>
      {open && (
        <pre className="m-0 mb-1 overflow-auto rounded-md bg-bg p-2 text-[10px]">
          {JSON.stringify(frame.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}
