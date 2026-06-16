import type { RunCheckResult } from "../types/Postcondition";

export function CheckVerdictPanel({ result }: { result: RunCheckResult }) {
  const single = result.attempts.length <= 1;
  if (single) {
    const v = result.attempts[0]?.verdict;
    return (
      <div className="rounded-md border border-border bg-bg p-2 text-xs">
        <span
          className={`rounded-full px-1.5 text-[10px] font-semibold ${
            result.final === "met" ? "bg-st-ok-soft text-st-ok" : "bg-st-error-soft text-st-error"
          }`}
        >
          {result.final}
        </span>
        {v && <p className="mt-1 text-muted">{v.rationale}</p>}
      </div>
    );
  }
  return (
    <ol className="m-0 list-none p-0 text-xs">
      {result.attempts.map((a, i) => (
        <li key={a.attempt} className="mb-2">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2 w-2 rounded-full ${a.verdict.met ? "bg-st-ok" : "bg-st-error"}`}
            />
            <strong>Attempt {a.attempt}</strong>
            <span
              className={`rounded-full px-1.5 text-[10px] font-semibold ${
                a.verdict.met ? "bg-st-ok-soft text-st-ok" : "bg-st-error-soft text-st-error"
              }`}
            >
              {a.verdict.met ? "met" : "fail"}
            </span>
          </div>
          <p className="ml-4 mt-1 border-l-2 border-amber-700 bg-amber-50/5 px-2 italic text-amber-700">
            {a.verdict.rationale}
          </p>
          {!a.verdict.met && i < result.attempts.length - 1 && result.rewound_to && (
            <div className="ml-4 mt-1 text-[10px] text-amber-700">
              ↻ rewind to {result.rewound_to} · rationale injected
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
