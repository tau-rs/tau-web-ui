import { useStore } from "../store/store";

const REPO = "https://github.com/LEBOCQTitouan/tau-web-ui";

export function Footer() {
  const health = useStore((s) => s.health);
  const ok = health?.engine_ok ?? false;
  return (
    <footer className="flex items-center gap-3 border-t border-border bg-surface px-4 py-1.5 text-[11px] text-muted">
      <span>tau-web-ui</span>
      <span>·</span>
      <span>tau {health?.tau_version ?? "—"}</span>
      <span>·</span>
      <span className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-st-ok" : "bg-st-error"}`} />
        {ok ? "gateway ok" : "gateway down"}
      </span>
      <span className="ml-auto flex gap-3">
        <a href={REPO} target="_blank" rel="noreferrer" className="hover:text-fg">
          GitHub
        </a>
        <a
          href={`${REPO}/tree/main/docs`}
          target="_blank"
          rel="noreferrer"
          className="hover:text-fg"
        >
          docs
        </a>
      </span>
    </footer>
  );
}
