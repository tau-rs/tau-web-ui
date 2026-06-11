# Severity & Package-Status Badge Tones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop two "the semaphore lies" badge bugs where an unrecognized backend value renders in a benign/success tone on a triage surface (audit D3 + D13).

**Architecture:** Both surfaces currently `?? <benign default>` an unknown value into a friendly color. Fix by validating the value on render: known values keep their tone; an unrecognized value gets an explicit, escalated (non-benign) tone instead of silently borrowing a safe one. Reuse the existing binary tone pattern (ShipPage's reproducible→`st-ok` / else→`st-error`; HealthPage's `SEV_CLASS`).

**Tech Stack:** React + TypeScript, Tailwind (`st-*` design tokens), Vitest + Testing Library.

**Known severities emitted by the app** (HealthPage): `error`, `needs-setup`, `warning`, `pass`, `note`. **Package verify success token** (gateway `parse_verify_jsonl`): uniquely `"ok"`; everything else (`drift`, `stale`, `unverified`, `failed`, …) is non-success; absent status renders the `—` placeholder.

**Note:** `web/src/types/CheckFinding.ts` and `Event.ts` are ts-rs generated ("Do not edit") and the Rust source lives in a separate repo, so we take the brief's "validate on receipt" branch (render-time validation) rather than editing generated files.

---

### Task 1: HealthPage — unknown severity escalates instead of defaulting to warning (D3)

**Files:**
- Modify: `web/src/health/HealthPage.tsx:8-22` (`SEV_CLASS` + `SeverityBadge`)
- Test: `web/src/health/HealthPage.test.tsx`

- [ ] **Step 1: Write failing test** — add a `severity: "critical"` finding to the report fixture and assert the badge is NOT the warning tone and IS the escalated/error tone.

```tsx
it("renders an unknown severity in an escalated tone, never the benign warning tone", async () => {
  render(
    <ProjectProvider pid="demo">
      <HealthPage />
    </ProjectProvider>,
  );
  await waitFor(() => expect(screen.getByText("tau.critical.unknown")).toBeInTheDocument());
  const badge = screen.getByText(/critical/);
  // unknown must escalate (error tone), not silently render as the benign yellow "warning"
  expect(badge.className).toContain("text-st-error");
  expect(badge.className).not.toContain("text-st-running");
});
```
(Also add to the `report.findings` fixture: `{ category: "config", severity: "critical", rule: "tau.critical.unknown", summary: "unknown severity from backend", detail: null, remediation: null, location: null }`.)

- [ ] **Step 2: Run, verify it fails** — `pnpm test HealthPage` → FAIL (badge currently `text-st-running`).

- [ ] **Step 3: Implement** — give `note` a real (neutral) tone so it stays known, and route unrecognized severities to an explicit escalated tone + an `unrecognized severity` marker.

```tsx
const SEV_CLASS: Record<string, string> = {
  error: "bg-st-error-soft text-st-error",
  "needs-setup": "bg-amber-100 text-amber-800",
  warning: "bg-st-running-soft text-st-running",
  pass: "bg-st-ok-soft text-st-ok",
  note: "bg-st-cancelled-soft text-st-cancelled",
};
// An unrecognized severity must never borrow a benign tone on a triage surface —
// escalate it (error tone) and mark it so a typo/new value can't masquerade.
const SEV_UNKNOWN = "bg-st-error-soft text-st-error";

function SeverityBadge({ severity, label }: { severity: string; label?: string }) {
  const known = Object.prototype.hasOwnProperty.call(SEV_CLASS, severity);
  const cls = known ? SEV_CLASS[severity] : SEV_UNKNOWN;
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
      title={known ? undefined : `unrecognized severity: ${severity}`}
    >
      {label ?? (known ? severity : `? ${severity}`)}
    </span>
  );
}
```

- [ ] **Step 4: Run, verify pass** — `pnpm test HealthPage` → PASS (existing tests still green; `note` sandbox badge now neutral not yellow).

### Task 2: PackagesPage — non-"ok" status loses the success tone (D13)

**Files:**
- Modify: `web/src/packages/PackagesPage.tsx:96-100` (status cell)
- Test: `web/src/packages/PackagesPage.test.tsx`

- [ ] **Step 1: Write failing test** — verify returns a `"drift"` package; assert its status badge is NOT green and IS the error tone; and that an un-verified package's `—` placeholder is neutral, not green.

```tsx
it("does not render a failed/drift package status in the success tone", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/packages/verify"))
        return Promise.resolve({
          ok: true,
          json: async () => ({ results: [{ name: "anthropic", status: "drift" }] }),
        });
      if (url.includes("/packages"))
        return Promise.resolve({
          ok: true,
          json: async () => ({
            packages: [
              { name: "anthropic", version: "0.1.0", source: "github.com/tau/anthropic", scope: "project", version_count: 1 },
            ],
          }),
        });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }),
  );
  render(
    <ProjectProvider pid="demo">
      <PackagesPage />
    </ProjectProvider>,
  );
  await waitFor(() => expect(screen.getByText("anthropic")).toBeInTheDocument());
  // before verify: placeholder is neutral, never the success green
  const placeholder = screen.getByText("—");
  expect(placeholder.className).not.toContain("text-st-ok");
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  const drift = await screen.findByText("drift");
  expect(drift.className).toContain("text-st-error");
  expect(drift.className).not.toContain("text-st-ok");
});
```

- [ ] **Step 2: Run, verify it fails** — `pnpm test PackagesPage` → FAIL (status span is always `text-st-ok`).

- [ ] **Step 3: Implement** — replace the always-green span with a tone-mapped badge.

```tsx
// Verify reports "ok" for a reproducible package. Anything else — drift, stale,
// unverified, failed, or an unrecognized value — is not a success and must not
// borrow the success tone. No status yet = neutral placeholder, not green.
const PKG_STATUS_CLASS: Record<string, string> = {
  ok: "bg-st-ok-soft text-st-ok",
};
function StatusBadge({ status }: { status: string | undefined }) {
  const cls =
    status == null
      ? "bg-st-cancelled-soft text-st-cancelled"
      : (PKG_STATUS_CLASS[status] ?? "bg-st-error-soft text-st-error");
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{status ?? "—"}</span>
  );
}
```
And in the status cell:
```tsx
<td className="px-3 py-2">
  <StatusBadge status={status[p.name]} />
</td>
```

- [ ] **Step 4: Run, verify pass** — `pnpm test PackagesPage` → PASS.

### Task 3: Verify + ship

- [ ] `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm exec prettier --check .` (or `--write`), `pnpm build` — all green.
- [ ] Full `pnpm test` (CI — node 20). Commit, push, `gh pr create -R tau-rs/tau-web-ui --base main` citing D3 + D13.
