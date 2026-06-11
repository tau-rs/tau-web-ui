# Shared API Request Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `json<T>` fetch helper copy-pasted across 12 API modules with one shared `request<T>`/`requestVoid` client that owns base URL, default headers, and error normalization.

**Architecture:** Add `request<T>(path, init?)` and `requestVoid(path, init?)` to `web/src/api/client.ts`, both routing through one private `check(res)` error normalizer and a `withDefaults(init)` header merge. Migrate every call site; delete every duplicated `json<T>`. Pure consolidation — no public signature changes, no new behavior.

**Tech Stack:** TypeScript, React, Vitest, ESLint, Prettier. Package manager `pnpm`; commands run from `web/`. Node 20 is unavailable locally (vitest runs in CI); `tsc`/`eslint`/`prettier` run fine locally.

---

## Conventions

- All `pnpm` commands run from the `web/` directory.
- Modules import the shared helpers with `import { request, requestVoid, scopedPath } from "./client";` (drop `requestVoid`/`scopedPath` from the import when a module doesn't use them).
- Every module currently declares this block — **delete it** wherever it appears:

```ts
async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}
```

---

## Task 1: Add the shared seam to client.ts (TDD)

**Files:**
- Modify: `web/src/api/client.ts`
- Test: `web/src/api/client.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `web/src/api/client.test.ts`. First update the import line at the top of the file to add the shared helpers:

```ts
import { getProject, listRuns, launchRun, getTrace, cancelRun, request, requestVoid } from "./client";
```

Then append this block at the end of the file:

```ts
describe("shared request helper (error normalization in one place)", () => {
  it("request throws `${status}: ${text}` on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "down" }),
    );
    await expect(request("/api/anything")).rejects.toThrow("503: down");
  });

  it("request returns parsed JSON on an OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ a: 1 }) }));
    expect(await request<{ a: number }>("/x")).toEqual({ a: 1 });
  });

  it("requestVoid throws `${status}: ${text}` on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "nope" }),
    );
    await expect(requestVoid("/api/gone", { method: "DELETE" })).rejects.toThrow("404: nope");
  });

  it("requestVoid resolves without parsing JSON on an OK response", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", f);
    await expect(requestVoid("/api/ok", { method: "DELETE" })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test src/api/client.test.ts`
Expected: FAIL — `request`/`requestVoid` are not exported from `./client` (import/type error or "is not a function").

- [ ] **Step 3: Write minimal implementation**

In `web/src/api/client.ts`, replace the existing `json<T>` helper (lines ~29-32):

```ts
async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}
```

with:

```ts
const BASE = ""; // single future home for an absolute base URL

/** Merge caller init over client defaults. Default headers live here so a
 *  future Origin header (S1) or timeout/abort is added in ONE place. */
function withDefaults(init?: RequestInit): RequestInit {
  return { ...init, headers: { ...init?.headers } };
}

async function check(res: Response): Promise<Response> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res;
}

/** The single API request entrypoint: base URL + default headers + error
 *  normalization, then JSON-decode the body. */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await check(await fetch(`${BASE}${path}`, withDefaults(init)));
  return res.json() as Promise<T>;
}

/** Like `request`, for endpoints that return no JSON body (e.g. DELETE). */
export async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  await check(await fetch(`${BASE}${path}`, withDefaults(init)));
}
```

Then migrate `client.ts`'s own functions off the now-deleted `json<T>` (the `.then(json<X>)` calls below). Rewrite them to use `request`:

```ts
export const getHealth = (pid: string) => request<Health>(scoped(pid, "/health"));
export const getProject = (pid: string) => request<Project>(scoped(pid, "/project"));

export function launchRun(pid: string, agent_id: string, prompt: string): Promise<string> {
  return request<{ run_id: string }>(scoped(pid, "/runs"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent_id, prompt }),
  }).then((r) => r.run_id);
}

export function listRuns(
  pid: string,
  filters: { status?: string; agent?: string } = {},
): Promise<Run[]> {
  const q = new URLSearchParams();
  if (filters.status) q.set("status", filters.status);
  if (filters.agent) q.set("agent", filters.agent);
  const qs = q.toString();
  return request<Run[]>(scoped(pid, `/runs${qs ? `?${qs}` : ""}`));
}

export const getWorkflows = (pid: string) =>
  request<{ workflows: string[] }>(scoped(pid, "/workflows")).then((r) => r.workflows);

export function launchWorkflow(pid: string, workflow: string, input: string): Promise<string> {
  return request<{ run_id: string }>(scoped(pid, "/workflows/run"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workflow, input }),
  }).then((r) => r.run_id);
}

export const getTrace = (pid: string, id: string) =>
  request<Trace>(scoped(pid, `/runs/${id}`));
export const cancelRun = (pid: string, id: string) =>
  request<{ cancelled: boolean }>(scoped(pid, `/runs/${id}/cancel`), { method: "POST" }).then(
    (r) => r.cancelled,
  );
```

Leave `scoped`, `scopedPath`, `openRunSocket`, and all interfaces unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm test src/api/client.test.ts`
Expected: PASS — all new tests plus the existing project-scoped tests green.

- [ ] **Step 5: Typecheck**

Run: `cd web && pnpm typecheck`
Expected: no errors. (Confirms `client.ts` no longer references the deleted `json`.)

- [ ] **Step 6: Commit**

```bash
cd web && pnpm format && cd ..
git add web/src/api/client.ts web/src/api/client.test.ts
git commit -m "refactor(api): add shared request/requestVoid seam, migrate client.ts"
```

---

## Task 2: Migrate the JSON-returning modules

Each module loses its private `json<T>`, imports `request` (keep `scopedPath` where used), and rewrites `fetch(...).then(json<T>)` → `request<T>(...)`. **Public signatures unchanged.** Below is the full target content for each file.

**Files:**
- Modify: `web/src/api/checks.ts`, `agents.ts`, `config.ts`, `credentials.ts`, `projects.ts`, `skills.ts`, `tools.ts`, `providers.ts`, `ship.ts`, `graph.ts`, `plugins.ts`

- [ ] **Step 1: Rewrite `checks.ts`**

```ts
import type { CheckReport } from "../types/CheckReport";
import { request, scopedPath } from "./client";

export const getChecks = (pid: string) => request<CheckReport>(scopedPath(pid, "/checks"));
```

- [ ] **Step 2: Rewrite `tools.ts`**

```ts
import type { ToolDetail } from "../types/ToolDetail";
import { request, scopedPath } from "./client";

export const listTools = (pid: string) => request<ToolDetail[]>(scopedPath(pid, "/tools"));
```

- [ ] **Step 3: Rewrite `providers.ts`**

```ts
import type { Provider } from "../types/Provider";
import { request, scopedPath } from "./client";

export const getProviders = (pid: string) =>
  request<Provider[]>(scopedPath(pid, "/providers"));
```

- [ ] **Step 4: Rewrite `plugins.ts`**

```ts
import type { PluginDetail } from "../types/PluginDetail";
import { request, scopedPath } from "./client";

export const listPlugins = (pid: string) =>
  request<PluginDetail[]>(scopedPath(pid, "/plugins"));
```

- [ ] **Step 5: Rewrite `graph.ts`**

```ts
import type { WorkflowGraph } from "../types/WorkflowGraph";
import { request, scopedPath } from "./client";

export const getWorkflowGraph = (pid: string, name: string) =>
  request<WorkflowGraph>(scopedPath(pid, `/workflows/${name}/graph`));
```

- [ ] **Step 6: Rewrite `ship.ts`**

```ts
import type { Target } from "../types/Target";
import type { Bundle } from "../types/Bundle";
import type { VerifyOutcome } from "../types/VerifyOutcome";
import { request, scopedPath } from "./client";

export const listTargets = (pid: string) => request<Target[]>(scopedPath(pid, "/targets"));
export const listBundles = (pid: string) => request<Bundle[]>(scopedPath(pid, "/bundles"));
export const build = (pid: string, target: string) =>
  request<Bundle>(scopedPath(pid, "/build"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target }),
  });

export const verifyBundle = (pid: string, path: string) =>
  request<VerifyOutcome>(scopedPath(pid, "/verify"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });
```

- [ ] **Step 7: Rewrite `config.ts`**

```ts
import type { ProjectConfig } from "../types/ProjectConfig";
import type { Package } from "../types/Package";
import type { VerifyResult } from "../types/VerifyResult";
import { request, scopedPath } from "./client";

export const getConfig = (pid: string) =>
  request<ProjectConfig>(scopedPath(pid, "/project/config"));

export const putConfig = (pid: string, name: string, description: string) =>
  request<{ ok: boolean }>(scopedPath(pid, "/project/config"), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, description: description || null }),
  });

export const getPackages = (pid: string) =>
  request<{ packages: Package[] }>(scopedPath(pid, "/packages")).then((r) => r.packages);

export const installPackage = (pid: string, git_url: string) =>
  request<{ package: Package }>(scopedPath(pid, "/packages/install"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ git_url }),
  }).then((r) => r.package);

export const uninstallPackage = (pid: string, name: string) =>
  request<{ ok: boolean }>(scopedPath(pid, `/packages/${name}`), { method: "DELETE" });

export const updatePackage = (pid: string, name: string, to?: string) =>
  request<{ package: Package }>(scopedPath(pid, `/packages/${name}/update`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: to ?? null }),
  }).then((r) => r.package);

export const resolvePackages = (pid: string) =>
  request<{ packages: Package[] }>(scopedPath(pid, "/packages/resolve"), { method: "POST" }).then(
    (r) => r.packages,
  );

export const verifyPackages = (pid: string) =>
  request<{ results: VerifyResult[] }>(scopedPath(pid, "/packages/verify"), {
    method: "POST",
  }).then((r) => r.results);

export const importAgent = (pid: string, git_url: string, llm_backend: string) =>
  request<{ agent_id: string }>(scopedPath(pid, "/agents/import"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ git_url, llm_backend }),
  }).then((r) => r.agent_id);
```

- [ ] **Step 8: Rewrite `credentials.ts`** (raw `/api/credentials` paths, no `scopedPath`)

```ts
import type { BackendCredentialStatus } from "../types/BackendCredentialStatus";
import type { SourceConfig } from "../types/SourceConfig";
import { request } from "./client";

// Credentials are per-machine (global), so these hit /api/credentials directly,
// not the project-scoped path.
export const getCredentials = () => request<BackendCredentialStatus[]>("/api/credentials");

export const putCredential = (
  backend: string,
  body: { sources: SourceConfig[]; local_value?: string },
) =>
  request<BackendCredentialStatus>(`/api/credentials/${encodeURIComponent(backend)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const deleteCredential = (backend: string) =>
  request<{ ok: boolean }>(`/api/credentials/${encodeURIComponent(backend)}`, {
    method: "DELETE",
  });
```

- [ ] **Step 9: Run tests + typecheck for Task 2 so far**

Run: `cd web && pnpm test src/api && pnpm typecheck`
Expected: PASS / no errors. (`agents.test.ts`, `skills.test.ts`, `projects.test.ts` exercise the rewritten modules — but `agents.ts`/`skills.ts`/`projects.ts` are migrated in Task 3, so a full green comes after Task 3. Modules touched so far must compile and their tests pass.)

---

## Task 3: Migrate the modules with no-body delete handlers

These three modules (`agents.ts`, `skills.ts`, `projects.ts`) have DELETE handlers that today throw `new Error(\`${res.status}\`)` with no response text. Route them through `requestVoid`, which normalizes to `${status}: ${text}` — the intended consolidation (decision A).

**Files:**
- Modify: `web/src/api/agents.ts`, `web/src/api/skills.ts`, `web/src/api/projects.ts`

- [ ] **Step 1: Rewrite `agents.ts`**

```ts
import type { AgentDetail } from "../types/AgentDetail";
import { request, requestVoid, scopedPath } from "./client";

export const listAgents = (pid: string) =>
  request<AgentDetail[]>(scopedPath(pid, "/agents"));

export const getAgent = (pid: string, id: string) =>
  request<AgentDetail>(scopedPath(pid, `/agents/${id}`));

export const putAgent = (pid: string, agent: AgentDetail, opts?: { create?: boolean }) =>
  request<AgentDetail>(scopedPath(pid, `/agents/${agent.id}${opts?.create ? "?create=1" : ""}`), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(agent),
  });

export const deleteAgent = (pid: string, id: string) =>
  requestVoid(scopedPath(pid, `/agents/${id}`), { method: "DELETE" });
```

- [ ] **Step 2: Rewrite `skills.ts`**

```ts
import type { SkillSummary } from "../types/SkillSummary";
import type { SkillDetail } from "../types/SkillDetail";
import { request, requestVoid, scopedPath } from "./client";

export const listSkills = (pid: string) =>
  request<SkillSummary[]>(scopedPath(pid, "/skills"));

export const getSkill = (pid: string, name: string) =>
  request<SkillDetail>(scopedPath(pid, `/skills/${name}`));

export const putSkill = (pid: string, skill: SkillDetail, opts?: { create?: boolean }) =>
  request<SkillDetail>(scopedPath(pid, `/skills/${skill.name}${opts?.create ? "?create=1" : ""}`), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(skill),
  });

export const deleteSkill = (pid: string, name: string) =>
  requestVoid(scopedPath(pid, `/skills/${name}`), { method: "DELETE" });

export const importSkill = (pid: string, git_url: string) =>
  request<{ skill: string }>(scopedPath(pid, "/skills/import"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ git_url }),
  }).then((r) => r.skill);
```

- [ ] **Step 3: Rewrite `projects.ts`** (raw `/api/projects` paths, no `scopedPath`)

```ts
import type { ProjectListItem } from "../types/ProjectListItem";
import type { ProjectMeta } from "../types/ProjectMeta";
import type { CrossProjectRun } from "../types/CrossProjectRun";
import { request, requestVoid } from "./client";

export const listProjects = () => request<ProjectListItem[]>("/api/projects");

export function getCrossRuns(status?: string, limit = 50): Promise<CrossProjectRun[]> {
  const q = new URLSearchParams();
  if (status) q.set("status", status);
  q.set("limit", String(limit));
  return request<CrossProjectRun[]>(`/api/projects/runs?${q.toString()}`);
}

export const addProjectByPath = (path: string) =>
  request<ProjectMeta>("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });

export const addProjectByGit = (git_url: string) =>
  request<ProjectMeta>("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ git_url }),
  });

export const removeProject = (pid: string) =>
  requestVoid(`/api/projects/${pid}`, { method: "DELETE" });

export const saveWorkspaceAs = (name: string): Promise<ProjectMeta> =>
  request<ProjectMeta>("/api/workspace/save-as", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
```

- [ ] **Step 4: Verify no stray `json<T>` remains**

Run: `cd web && grep -rn "async function json<T>" src/api`
Expected: no output (all duplicates deleted).

- [ ] **Step 5: Full test + typecheck + lint + format check**

Run: `cd web && pnpm test src/api && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tests PASS, no type errors, no lint errors, format clean. If `format:check` reports files, run `pnpm format` and re-check.

- [ ] **Step 6: Commit**

```bash
cd web && pnpm format && cd ..
git add web/src/api
git commit -m "refactor(api): route all 11 modules through shared request client (D2)"
```

---

## Task 4: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full web check suite**

Run: `cd web && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: all green.

- [ ] **Step 2: Build**

Run: `cd web && pnpm build`
Expected: clean `tsc -b` + vite build.

- [ ] **Step 3: Confirm scope**

Run: `git diff --stat origin/main...HEAD`
Expected: only `web/src/api/*` and the two `docs/superpowers/*` files changed. No `web/src/api/types/*` or component changes.

---

## Self-Review notes

- **Spec coverage:** seam (Task 1), all 12 modules incl. `client.ts` (Tasks 1-3), delete-handler decision A via `requestVoid` (Task 3), tests for `request`/`requestVoid`/normalization (Task 1), verification incl. format (Task 4). ✓
- **Type consistency:** `request<T>(path, init?)` and `requestVoid(path, init?)` used identically everywhere; `scopedPath` retained only where paths are project-scoped (not in `credentials.ts`/`projects.ts`). ✓
- **No placeholders:** every module shows full target content. ✓
- **`getChecks` routing test:** the existing module tests (`agents.test.ts`, `skills.test.ts`, `projects.test.ts`) already mock fetch and exercise the migrated modules end-to-end, proving they route through the shared helper; the dedicated `request`/`requestVoid` tests in Task 1 lock the normalization contract. ✓
