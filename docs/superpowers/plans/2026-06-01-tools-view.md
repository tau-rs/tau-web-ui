# Tools View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only **Tools** tab to the Tools & Skills surface: a mock-seeded catalog of tool packages, each row expandable inline to show provides/capabilities/source and the real per-project `used_by` (agents + local skills that reference it).

**Architecture:** A new gateway `tools` module (mock catalog seam + a `list_tools` composer that fills `used_by` from `config::list_agents` + `skills::list_local`); one scoped read-only endpoint `GET /api/projects/:pid/tools`; a frontend `ToolsTab` (inline-expand table) wired into `ToolsPage`'s tab switch. `Capability` is reused from the skills module.

**Tech Stack:** Rust, axum 0.7, serde, ts-rs, reqwest (dev); React 18, react-router-dom v6, Vitest, Playwright.

This is the single plan for Tools view (see `docs/superpowers/specs/2026-06-01-tools-view-design.md`) — slice **#2 of 3** of the Tools & Skills surface.

---

## File Structure

**New:**
- `gateway/src/tools/mod.rs` — `ToolUser`/`ToolDetail` types, `ToolsSource` seam (`MockTools`/`CliTools`), `list_tools` composer.
- `gateway/src/api/tools.rs` — the `list` handler.
- `web/src/api/tools.ts` — `listTools`.
- `web/src/tools/ToolsTab.tsx` — inline-expand tools table.
- Tests: `gateway/tests/tools_api.rs`, `web/src/tools/ToolsTab.test.tsx`, `web/src/tools/ToolsPage.test.tsx`.

**Modified:**
- `gateway/src/lib.rs` — `pub mod tools;`.
- `gateway/src/state.rs` — `tools_source` field + `list_tools` wrapper.
- `gateway/src/api/mod.rs` — `/tools` route.
- `web/src/tools/ToolsPage.tsx` — tab switch (Skills | Tools | Plugins-soon).
- `web/e2e/run.spec.ts` — tools tab spec.

---

## Task 1: Types + `ToolsSource` seam

**Files:**
- Create: `gateway/src/tools/mod.rs`
- Modify: `gateway/src/lib.rs`

- [ ] **Step 1: Add the module to lib.rs**

In `gateway/src/lib.rs`, insert `pub mod tools;` into the module list alphabetically — after `pub mod store;` and before `pub mod trace;`:

```rust
pub mod store;
pub mod tools;
pub mod trace;
```

- [ ] **Step 2: Create `gateway/src/tools/mod.rs`**

```rust
//! Tools view: a read-only catalog of tool packages (kind="tool") plus a
//! per-project `used_by`, computed from the project's agents + local skills.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::skills::Capability;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ToolUser {
    pub kind: String, // "agent" | "skill"
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ToolDetail {
    pub name: String,
    pub version: Option<String>,
    pub source: String,
    pub provides: String,
    pub plugin_kind: Option<String>,
    pub binary: Option<String>,
    pub capabilities: Vec<Capability>,
    pub used_by: Vec<ToolUser>,
}

/// Source of the tool catalog (used_by left empty; filled by `list_tools`).
pub trait ToolsSource: Send + Sync {
    fn catalog(&self) -> Vec<ToolDetail>;
}

pub struct MockTools;

impl ToolsSource for MockTools {
    fn catalog(&self) -> Vec<ToolDetail> {
        let cap = |kind: &str, param: &str, vals: &[&str]| Capability {
            kind: kind.into(),
            fields: BTreeMap::from([(
                param.to_string(),
                vals.iter().map(|s| s.to_string()).collect(),
            )]),
        };
        let tool = |name: &str, version: &str, c: Capability| ToolDetail {
            name: name.into(),
            version: Some(version.into()),
            source: format!("github.com/tau/{name}"),
            provides: "tool".into(),
            plugin_kind: Some("rust-cargo".into()),
            binary: Some(name.into()),
            capabilities: vec![c],
            used_by: vec![],
        };
        vec![
            tool("fs-read", "1.0.0", cap("fs.read", "paths", &["${WORKDIR}/**"])),
            tool("shell", "0.2.0", cap("process.spawn", "commands", &["sh"])),
            tool("web-search", "1.2.0", cap("net.http", "hosts", &["*"])),
        ]
    }
}

/// CLI seam — not wired in v1 (the mock covers fake-tau-serve).
pub struct CliTools;

impl ToolsSource for CliTools {
    fn catalog(&self) -> Vec<ToolDetail> {
        vec![]
    }
}
```

- [ ] **Step 3: Write the failing test**

Add a test module at the bottom of `gateway/src/tools/mod.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_catalog_seeds_three_tools() {
        let cat = MockTools.catalog();
        let names: Vec<&str> = cat.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["fs-read", "shell", "web-search"]);
        let fsr = &cat[0];
        assert_eq!(fsr.provides, "tool");
        assert_eq!(fsr.plugin_kind.as_deref(), Some("rust-cargo"));
        assert_eq!(fsr.capabilities[0].kind, "fs.read");
        assert!(fsr.used_by.is_empty()); // filled by list_tools
        assert!(CliTools.catalog().is_empty());
    }
}
```

- [ ] **Step 4: Run + commit**

Run: `cargo test -p tau-gateway --lib tools::tests::mock_catalog_seeds_three_tools`
Expected: PASS. Also `cargo build -p tau-gateway` (compiles; `Path` import is unused until Task 2 — warning OK).

```bash
git add gateway/src/lib.rs gateway/src/tools/mod.rs
git commit -m "feat(gateway): tool types + mock catalog seam"
```

---

## Task 2: `list_tools` composer (used_by) + AppState wrapper

**Files:**
- Modify: `gateway/src/tools/mod.rs`, `gateway/src/state.rs`

- [ ] **Step 1: Add `list_tools` to `gateway/src/tools/mod.rs`** (after `CliTools`):

```rust
/// Compose the catalog with per-project `used_by`: scan the project's agents
/// (`requires.tools`) + local skills (`requires_tools`) for each tool name.
pub fn list_tools(project: &Path, source: &dyn ToolsSource) -> Vec<ToolDetail> {
    let agents = crate::config::list_agents(project).unwrap_or_default();
    let skills: Vec<_> = crate::skills::list_local(project)
        .iter()
        .filter_map(|s| crate::skills::read_local(project, &s.name).ok().flatten())
        .collect();

    let mut tools = source.catalog();
    for t in &mut tools {
        let mut users = vec![];
        for a in &agents {
            if a.requires_tools.iter().any(|r| r.name == t.name) {
                users.push(ToolUser {
                    kind: "agent".into(),
                    name: a.id.clone(),
                });
            }
        }
        for s in &skills {
            if s.requires_tools.iter().any(|r| r.name == t.name) {
                users.push(ToolUser {
                    kind: "skill".into(),
                    name: s.name.clone(),
                });
            }
        }
        t.used_by = users;
    }
    tools
}
```

- [ ] **Step 2: Write the failing test** (append to the `tests` module):

```rust
    fn demo() -> std::path::PathBuf {
        let mut p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        p.pop();
        p.push("fixtures/demo");
        p
    }

    #[test]
    fn list_tools_computes_used_by_from_demo() {
        let tools = list_tools(&demo(), &MockTools);
        let fsr = tools.iter().find(|t| t.name == "fs-read").unwrap();
        // the seeded `critic` skill requires fs-read
        assert!(fsr.used_by.iter().any(|u| u.kind == "skill" && u.name == "critic"));
        let shell = tools.iter().find(|t| t.name == "shell").unwrap();
        assert!(shell.used_by.is_empty());
    }
```

- [ ] **Step 3: Add the AppState field + wrapper**

In `gateway/src/state.rs`, add to the `use` block:

```rust
use crate::tools::{self, ToolDetail, ToolsSource};
```

Add a field to `Inner` (near `installed_skills`):

```rust
    tools_source: Box<dyn ToolsSource>,
```

In `AppState::new`, build it next to `installed_skills` (`is_mock` is in scope):

```rust
        let tools_source: Box<dyn ToolsSource> = if is_mock {
            Box::new(tools::MockTools)
        } else {
            Box::new(tools::CliTools)
        };
```

and add `tools_source` to the `Inner { ... }` literal.

Add the wrapper inside `impl AppState`:

```rust
    pub fn list_tools(&self) -> Vec<ToolDetail> {
        tools::list_tools(&self.0.project, self.0.tools_source.as_ref())
    }
```

- [ ] **Step 4: Run + commit**

Run: `cargo build -p tau-gateway && cargo test -p tau-gateway --lib tools::tests`
Expected: PASS (2 tests). Also `cargo test -p tau-gateway --lib` to confirm no regressions.

```bash
git add gateway/src/tools/mod.rs gateway/src/state.rs
git commit -m "feat(gateway): list_tools used_by composer + AppState wrapper"
```

---

## Task 3: API route + integration test

**Files:**
- Create: `gateway/src/api/tools.rs`, `gateway/tests/tools_api.rs`
- Modify: `gateway/src/api/mod.rs`

- [ ] **Step 1: Create `gateway/src/api/tools.rs`**

```rust
use axum::Json;

use crate::api::scope::Scoped;
use crate::tools::ToolDetail;

pub async fn list(Scoped(state): Scoped) -> Json<Vec<ToolDetail>> {
    Json(state.list_tools())
}
```

- [ ] **Step 2: Wire the route in `gateway/src/api/mod.rs`**

Add `pub mod tools;` to the module list at the top. In the `scoped` router (near the skills routes), add:

```rust
        .route("/tools", get(tools::list))
```

(`get` is already imported via `axum::routing::{delete, get, post}`.)

- [ ] **Step 3: Create `gateway/tests/tools_api.rs`**

```rust
use std::path::PathBuf;
use tau_gateway::{api, projects::ProjectRegistry};

fn bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}
fn project() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("fixtures/demo");
    p
}

async fn serve(reg: ProjectRegistry) -> String {
    let app = api::router(reg);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn tools_list_over_http() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let meta = reg.add_local(&project()).await.unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();

    let list: serde_json::Value = http
        .get(format!("{base}/api/projects/{}/tools", meta.id))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let arr = list.as_array().unwrap();
    assert_eq!(arr.len(), 3);
    let fsr = arr.iter().find(|t| t["name"] == "fs-read").unwrap();
    assert_eq!(fsr["provides"], "tool");
    assert_eq!(fsr["capabilities"][0]["kind"], "fs.read");
    // critic skill requires fs-read
    assert!(fsr["used_by"]
        .as_array()
        .unwrap()
        .iter()
        .any(|u| u["kind"] == "skill" && u["name"] == "critic"));
}
```

- [ ] **Step 4: Run + commit**

Run: `cargo build -p fake-tau-serve && cargo test -p tau-gateway --test tools_api`
Expected: PASS. (Read-only — no fixture mutation; `git status --porcelain fixtures/demo` stays clean.)

```bash
git add gateway/src/api/tools.rs gateway/src/api/mod.rs gateway/tests/tools_api.rs
git commit -m "feat(gateway): GET /tools route + integration test"
```

---

## Task 4: ts-rs export + rust gate

**Files:**
- Regenerated: `web/src/types/{ToolUser,ToolDetail}.ts`

- [ ] **Step 1: Regenerate** — `cargo build -p fake-tau-serve && cargo test -p tau-gateway` → PASS; new files under `web/src/types/`. Confirm `git status --porcelain fixtures/demo` is empty.

- [ ] **Step 2: Verify** — `ls web/src/types/ | grep -E "ToolUser|ToolDetail"` → both present. `cat web/src/types/ToolDetail.ts` should reference `Capability` and `ToolUser`.

- [ ] **Step 3: Full rust gate** — `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test -p tau-gateway` → green. Fix fmt/clippy minimally (`cargo fmt --all`). The pre-existing ts-rs serde-attr note is benign.

- [ ] **Step 4: Commit**

```bash
git add web/src/types gateway/
git commit -m "chore(gateway): export tool TS bindings + fmt/clippy"
```

---

## Task 5: Frontend — `api/tools.ts` + `ToolsTab` + `ToolsPage` tab switch

**Files:**
- Create: `web/src/api/tools.ts`, `web/src/tools/ToolsTab.tsx`, `web/src/tools/ToolsTab.test.tsx`, `web/src/tools/ToolsPage.test.tsx`
- Modify: `web/src/tools/ToolsPage.tsx`

- [ ] **Step 1: Create `web/src/api/tools.ts`**

```ts
import type { ToolDetail } from "../types/ToolDetail";
import { scopedPath } from "./client";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const listTools = () => fetch(scopedPath("/tools")).then(json<ToolDetail[]>);
```

- [ ] **Step 2: Write the failing `ToolsTab` test `web/src/tools/ToolsTab.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolsTab } from "./ToolsTab";

const tools = [
  {
    name: "fs-read",
    version: "1.0.0",
    source: "github.com/tau/fs-read",
    provides: "tool",
    plugin_kind: "rust-cargo",
    binary: "fs-read",
    capabilities: [{ kind: "fs.read", fields: { paths: ["/x/**"] } }],
    used_by: [{ kind: "skill", name: "critic" }],
  },
  {
    name: "shell",
    version: "0.2.0",
    source: "github.com/tau/shell",
    provides: "tool",
    plugin_kind: "rust-cargo",
    binary: "shell",
    capabilities: [{ kind: "process.spawn", fields: { commands: ["sh"] } }],
    used_by: [],
  },
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => tools }));
});

describe("ToolsTab", () => {
  it("lists tools and expands one to show capability + used_by", async () => {
    const user = userEvent.setup();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText("fs-read")).toBeInTheDocument());
    expect(screen.getByText("shell")).toBeInTheDocument();

    // expand fs-read
    await user.click(screen.getByRole("button", { name: /fs-read/i }));
    expect(screen.getByText(/fs\.read/)).toBeInTheDocument();
    expect(screen.getByText("critic")).toBeInTheDocument();
  });

  it("shows 'unused' for a tool with no users when expanded", async () => {
    const user = userEvent.setup();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText("shell")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /shell/i }));
    expect(screen.getByText(/unused/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Create `web/src/tools/ToolsTab.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { ToolDetail } from "../types/ToolDetail";
import { listTools } from "../api/tools";

const MAX_CHIPS = 6;

export function ToolsTab() {
  const [tools, setTools] = useState<ToolDetail[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    listTools()
      .then(setTools)
      .catch(() => {});
  }, []);

  function toggle(name: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-border text-left text-muted">
          <th className="py-1 pr-2 font-medium">tool</th>
          <th className="px-2 py-1 font-medium">version</th>
          <th className="px-2 py-1 font-medium">provides</th>
          <th className="px-2 py-1 font-medium">capabilities</th>
          <th className="px-2 py-1 font-medium">used by</th>
        </tr>
      </thead>
      <tbody>
        {tools.map((t) => (
          <ToolRow key={t.name} tool={t} expanded={open.has(t.name)} onToggle={() => toggle(t.name)} />
        ))}
      </tbody>
    </table>
  );
}

function ToolRow({
  tool,
  expanded,
  onToggle,
}: {
  tool: ToolDetail;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-b border-border/60">
        <td className="py-1 pr-2 font-medium">
          <button onClick={onToggle} className="text-accent">
            {tool.name} {expanded ? "▾" : "▸"}
          </button>
        </td>
        <td className="px-2 py-1 text-muted">{tool.version ?? "—"}</td>
        <td className="px-2 py-1 font-mono text-muted">{tool.provides}</td>
        <td className="px-2 py-1 font-mono text-muted">
          {tool.capabilities.map((c) => c.kind).join(", ") || "—"}
        </td>
        <td className="px-2 py-1 text-muted">{tool.used_by.length}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/60 bg-accent/5">
          <td colSpan={5} className="px-4 py-3 text-xs">
            <div className="mb-1.5">
              <span className="text-[9px] uppercase text-muted">provides </span>
              port <b>{tool.provides}</b>
              {tool.plugin_kind && ` · ${tool.plugin_kind}`}
              {tool.binary && (
                <>
                  {" · binary "}
                  <span className="font-mono">{tool.binary}</span>
                </>
              )}
            </div>
            <div className="mb-1.5">
              <span className="text-[9px] uppercase text-muted">capabilities </span>
              {tool.capabilities.map((c, i) => (
                <span key={i} className="mr-2 font-mono">
                  {c.kind}{" "}
                  {Object.entries(c.fields)
                    .map(([k, v]) => `${k}=[${v.join(", ")}]`)
                    .join(" ")}
                </span>
              ))}
            </div>
            <div className="mb-1.5">
              <span className="text-[9px] uppercase text-muted">used by </span>
              {tool.used_by.length === 0 ? (
                <span className="text-muted">unused</span>
              ) : (
                <>
                  {tool.used_by.slice(0, MAX_CHIPS).map((u, i) => (
                    <span
                      key={i}
                      className={`mr-1 inline-block rounded-full px-2 text-[9px] ${
                        u.kind === "skill" ? "bg-st-ok/15 text-st-ok" : "bg-accent/10 text-accent"
                      }`}
                    >
                      {u.name}
                    </span>
                  ))}
                  {tool.used_by.length > MAX_CHIPS && (
                    <span className="text-[9px] font-semibold text-accent">
                      +{tool.used_by.length - MAX_CHIPS} more
                    </span>
                  )}
                </>
              )}
            </div>
            <div>
              <span className="text-[9px] uppercase text-muted">source </span>
              <span className="font-mono text-muted">{tool.source}</span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
```

- [ ] **Step 4: Write the failing `ToolsPage` tab-switch test `web/src/tools/ToolsPage.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ToolsPage } from "./ToolsPage";

beforeEach(() => {
  // both SkillsIndex and ToolsTab fetch on mount — stub to empty arrays
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
});

function renderAt() {
  render(
    <MemoryRouter initialEntries={["/projects/demo/tools"]}>
      <Routes>
        <Route path="/projects/:pid/tools" element={<ToolsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ToolsPage tabs", () => {
  it("defaults to Skills, switches to Tools, Plugins is disabled", async () => {
    const user = userEvent.setup();
    renderAt();
    // Skills tab shows the import-skill control
    expect(screen.getByLabelText("import skill git url")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^tools$/i }));
    // Tools tab shows the tools table header "provides"
    expect(screen.getByText("provides")).toBeInTheDocument();
    expect(screen.queryByLabelText("import skill git url")).not.toBeInTheDocument();

    // Plugins is a disabled element, not a switchable tab
    expect(screen.getByText(/plugins/i).closest("[aria-disabled]")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
```

- [ ] **Step 5: Rewrite `web/src/tools/ToolsPage.tsx` with the tab switch**

```tsx
import { useState } from "react";
import { SkillsIndex } from "./SkillsIndex";
import { ToolsTab } from "./ToolsTab";

export function ToolsPage() {
  const [tab, setTab] = useState<"skills" | "tools">("skills");
  const chip = (active: boolean) =>
    `rounded-md px-3 py-1 text-xs font-semibold ${
      active ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
    }`;
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Tools &amp; Skills</h2>
        <div className="ml-2 flex gap-1">
          <button className={chip(tab === "skills")} onClick={() => setTab("skills")}>
            Skills
          </button>
          <button className={chip(tab === "tools")} onClick={() => setTab("tools")}>
            Tools
          </button>
          <span
            aria-disabled="true"
            className="cursor-not-allowed rounded-md px-3 py-1 text-xs font-semibold text-muted opacity-50"
          >
            Plugins{" "}
            <span className="ml-1 rounded bg-amber-100 px-1 text-[8px] font-bold uppercase text-amber-800">
              soon
            </span>
          </span>
        </div>
      </div>
      {tab === "skills" ? <SkillsIndex /> : <ToolsTab />}
    </div>
  );
}
```

- [ ] **Step 6: Run + commit**

Run: `cd web && pnpm test -- src/tools/ToolsTab.test.tsx src/tools/ToolsPage.test.tsx && pnpm test && pnpm typecheck`
Expected: all green.

```bash
git add web/src/api/tools.ts web/src/tools/ToolsTab.tsx web/src/tools/ToolsTab.test.tsx web/src/tools/ToolsPage.tsx web/src/tools/ToolsPage.test.tsx
git commit -m "feat(web): read-only Tools tab (inline expand + used_by) + tab switch"
```

---

## Task 6: E2e + final gate

**Files:**
- Modify: `web/e2e/run.spec.ts`

- [ ] **Step 1: Append the spec**

```ts
test("tools tab: list + expand shows used_by", async ({ page }) => {
  await page.goto("/projects/demo/tools");
  await page.getByRole("button", { name: /^tools$/i }).click();
  await expect(page.getByRole("button", { name: /fs-read/i })).toBeVisible({ timeout: 5000 });
  // expand fs-read → fs.read capability + used-by critic (the seeded skill requires it)
  await page.getByRole("button", { name: /fs-read/i }).click();
  await expect(page.getByText(/fs\.read/)).toBeVisible();
  await expect(page.getByText("critic")).toBeVisible();
});
```

- [ ] **Step 2: Kill stale servers, rebuild, run e2e**

```bash
lsof -nP -iTCP:4317 -iTCP:5173 -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null; sleep 1
cargo build -p tau-gateway -p fake-tau-serve
cd web && pnpm exec playwright test
```
Expected: ALL pass. Real ASSERTION failure → STOP, report BLOCKED. Missing-browser → `pnpm exec playwright install chromium` then retry; else `pnpm exec playwright test --list` and note e2e deferred to CI. A strict-mode "N elements" error → fix the selector minimally (`exact:true`/`.first()`), report the fix.

- [ ] **Step 3: Restore fixtures** (the tools surface is read-only, but the other specs mutate `fixtures/demo/tau.toml` + may leave skill dirs):

```bash
cd /Users/titouanlebocq/code/tau-ui
git checkout fixtures/demo/tau.toml docs/verification/trace-complete.png 2>/dev/null
git clean -fd fixtures/demo/skills >/dev/null 2>&1; git checkout fixtures/demo/skills 2>/dev/null
git status --porcelain fixtures/demo   # must be empty
true
```

- [ ] **Step 4: Full web gate** — `cd /Users/titouanlebocq/code/tau-ui/web && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` → green. If format:check fails, `pnpm format`, re-check, include in the commit.

- [ ] **Step 5: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/e2e/run.spec.ts
# include any prettier-formatted source (git status)
git commit -m "test(web): e2e tools tab + used_by"
```

---

## Self-Review

**Spec coverage** (`docs/superpowers/specs/2026-06-01-tools-view-design.md`):
- §2 types (`ToolUser`, `ToolDetail`, reuse `Capability`) → Task 1. §3.1 `ToolsSource`/`MockTools`/`CliTools` → Task 1. §3.2 `list_tools` used_by from `config::list_agents` + `skills::list_local`/`read_local` → Task 2. §3.3 AppState wrapper + `GET /tools` → Tasks 2–3. ts-rs/CI → Task 4. §4.1 `api/tools.ts` → Task 5. §4.2 `ToolsTab` (inline expand, capabilities, used_by truncation + "unused") + `ToolsPage` tab switch (Plugins disabled) → Task 5. §5 tests → Tasks 2, 3, 5, 6. All covered.

**Placeholder scan:** none — every step has complete code.

**Type consistency:** `ToolDetail { name, version?, source, provides, plugin_kind?, binary?, capabilities: Capability[], used_by: ToolUser[] }` and `ToolUser { kind, name }` are used identically across the module, the AppState wrapper, the handler, the integration test, and the frontend (`api/tools.ts`, `ToolsTab`). `list_tools(project, &dyn ToolsSource)` and `MockTools`/`CliTools::catalog()` signatures match their callers. `used_by` chips key off `u.kind === "skill"` matching the gateway's `"agent"|"skill"`. The reused `Capability.fields` (`{[k]: string[]}`) is rendered as `k=[v.join]`. The `GET /api/projects/:pid/tools` path matches `listTools` (`scopedPath("/tools")`).

**Note for executor:** the integration test + `cargo test` read `fixtures/demo` (read-only — no writes); other e2e specs mutate fixtures, so Task 6 Step 3 restores them. Verify `git status --porcelain fixtures/demo` is empty before the final commit.
