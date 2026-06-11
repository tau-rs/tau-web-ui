import type { ReactNode } from "react";
import type { AsyncState } from "./useAsync";

interface AsyncProps<T> {
  state: AsyncState<T> & { reload: () => void };
  skeleton: ReactNode;
  empty: ReactNode;
  children: (data: T) => ReactNode;
}

/** Render the slot matching a useAsync() state. */
export function Async<T>({ state, skeleton, empty, children }: AsyncProps<T>) {
  switch (state.status) {
    case "loading":
      return <>{skeleton}</>;
    case "empty":
      return <>{empty}</>;
    case "error":
      return (
        <div
          role="alert"
          className="flex flex-col items-start gap-1.5 rounded-md border border-st-error/40 bg-st-error-soft px-3 py-2 text-xs text-st-error"
        >
          <span>Couldn't load: {state.error}</span>
          <button
            onClick={state.reload}
            className="rounded border border-st-error/40 px-2 py-0.5 font-semibold"
          >
            Retry
          </button>
        </div>
      );
    case "data":
      return <>{children(state.data)}</>;
  }
}
