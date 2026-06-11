import { useCallback, useEffect, useRef, useState } from "react";
import type { DependencyList } from "react";
import { errorMessage } from "../notify/notify";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "empty" }
  | { status: "data"; data: T };

export type UseAsyncResult<T> = AsyncState<T> & { reload: () => void };

/**
 * Run an async fetcher and expose a 4-state lifecycle: loading | error | empty |
 * data. A failed read is logged for diagnostics and surfaced inline by the
 * caller's panel — it does NOT toast (distinct from surfaceError's mutation path).
 *
 * The effect is keyed on the caller-provided `deps`, not on `fetcher` (whose
 * identity changes every render). A request-id + mounted guard discard stale or
 * post-unmount results, including under StrictMode's double-invoke.
 */
export function useAsync<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList,
  opts: { isEmpty?: (d: T) => boolean } = {},
): UseAsyncResult<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const { isEmpty } = opts;
  const reqId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(() => {
    const id = ++reqId.current;
    setState({ status: "loading" });
    fetcher().then(
      (data) => {
        if (!mounted.current || id !== reqId.current) return;
        setState(isEmpty?.(data) ? { status: "empty" } : { status: "data", data });
      },
      (err) => {
        if (!mounted.current || id !== reqId.current) return;
        console.error("useAsync:", err);
        setState({ status: "error", error: errorMessage(err) });
      },
    );
    // We intentionally key this callback on the caller-provided `deps`, not on
    // `fetcher`/`isEmpty` (whose identities change every render). Both hook rules
    // that would object to a forwarded deps array are suppressed for that reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/use-memo
  }, deps);

  useEffect(() => {
    run();
  }, [run]);

  return { ...state, reload: run };
}
