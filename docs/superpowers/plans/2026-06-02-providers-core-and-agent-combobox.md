# Providers core + Agent combobox (Plan 1 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared **providers** data source (available LLM providers + a recommended one, from real config) and replace the agent editor's free-text `llm_backend` with an **editable combobox** (datalist) that marks the recommended provider and pre-fills new agents.

**Architecture:** A gateway `providers` composer (`list_providers` from agents' backends + installed package names; `recommended_backend` = modal-else-`anthropic`) behind a read-only `GET /providers`; a frontend `getProviders()` + an `<input list>` + `<datalist>` combobox in `AgentEditorPage`. This is **Plan 1 of 3** for spec `docs/superpowers/specs/2026-06-02-agent-providers-and-node-display-design.md`; Plans 2 (Providers screen) and 3 (n8n-grade canvas) consume this source.

**Tech Stack:** Rust, axum 0.7, serde, ts-rs; React 18, react-router-dom v6, Vitest, Playwright.

---

## File Structure

**New:** `gateway/src/providers/mod.rs`, `gateway/src/api/providers.rs`, `web/src/api/providers.ts`, tests `gateway/tests/providers_api.rs`, `web/src/agents/AgentEditorProvider.test.tsx`.
**Modified:** `gateway/src/lib.rs`, `gateway/src/state.rs`, `gateway/src/api/mod.rs`, `web/src/agents/AgentEditorPage.tsx`, `web/e2e/run.spec.ts`.

---

## Task 1: Providers composer (gateway)

**Files:** Create `gateway/src/providers/mod.rs`; Modify `gateway/src/lib.rs`.

- [ ] **Step 1: Add the module to lib.rs** — insert `pub mod providers;` alphabetically after `pub mod projects;` and before `pub mod serve_client;`:

```rust
pub mod projects;
pub mod providers;
pub mod serve_client;
```

- [ ] **Step 2: Create `gateway/src/providers/mod.rs`**

```rust
//! LLM providers: a composer over real project data (agents' `llm_backend` +
//! installed package names) yielding the available providers and the recommended
//! one. Shared by the agent editor, the workflow graph nodes, and the Providers
//! screen. Credentials are gated (β.5).

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Provider {
    pub name: String,
    pub installed: bool,          // name is an installed package
    pub recommended: bool,        // name == the resolved recommended backend
    pub source: String,           // "in-use" | "well-known"
    pub credentials_gated: bool,  // true in v1 (β.5)
}

const WELL_KNOWN: &[&str] = &["anthropic", "openai", "local"];

/// The recommended backend: the modal (most frequent) backend across the
/// project's agents, tie-broken by first appearance; `"anthropic"` when none set.
pub fn recommended_backend(agent_backends: &[String]) -> String {
    let mut order: Vec<&str> = vec![];
    let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for b in agent_backends {
        if b.is_empty() {
            continue;
        }
        let c = counts.entry(b.as_str()).or_insert(0);
        if *c == 0 {
            order.push(b.as_str());
        }
        *c += 1;
    }
    if order.is_empty() {
        return "anthropic".to_string();
    }
    let mut best = order[0];
    let mut best_n = counts[best];
    for &name in &order[1..] {
        if counts[name] > best_n {
            best = name;
            best_n = counts[name];
        }
    }
    best.to_string()
}

/// Available providers = (recommended, then in-use, then well-known), deduped.
/// `installed` reflects package membership; `source` distinguishes in-use vs known.
pub fn list_providers(agent_backends: &[String], package_names: &[String]) -> Vec<Provider> {
    let recommended = recommended_backend(agent_backends);

    let mut in_use: Vec<&str> = vec![];
    let mut in_use_seen = HashSet::new();
    for b in agent_backends {
        if !b.is_empty() && in_use_seen.insert(b.as_str()) {
            in_use.push(b.as_str());
        }
    }

    let mut names: Vec<String> = vec![];
    let mut seen = HashSet::new();
    for n in std::iter::once(recommended.as_str())
        .chain(in_use.iter().copied())
        .chain(WELL_KNOWN.iter().copied())
    {
        if seen.insert(n.to_string()) {
            names.push(n.to_string());
        }
    }

    let pkg: HashSet<&str> = package_names.iter().map(|s| s.as_str()).collect();
    let in_use_set: HashSet<&str> = in_use.iter().copied().collect();
    names
        .into_iter()
        .map(|name| Provider {
            installed: pkg.contains(name.as_str()),
            recommended: name == recommended,
            source: if in_use_set.contains(name.as_str()) {
                "in-use".into()
            } else {
                "well-known".into()
            },
            credentials_gated: true,
            name,
        })
        .collect()
}
```

- [ ] **Step 3: Write the failing tests** — add at the bottom of `gateway/src/providers/mod.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn recommended_is_modal_else_anthropic() {
        assert_eq!(recommended_backend(&[]), "anthropic");
        assert_eq!(
            recommended_backend(&s(&["anthropic", "anthropic", "openai"])),
            "anthropic"
        );
        // tie → first appearance
        assert_eq!(
            recommended_backend(&s(&["openai", "anthropic", "openai", "anthropic"])),
            "openai"
        );
    }

    #[test]
    fn list_marks_installed_recommended_source() {
        let ps = list_providers(&s(&["anthropic", "openai"]), &s(&["anthropic"]));
        let by = |n: &str| ps.iter().find(|p| p.name == n).cloned().unwrap();
        let anthropic = by("anthropic");
        assert!(anthropic.recommended);
        assert!(anthropic.installed);
        assert_eq!(anthropic.source, "in-use");
        assert!(anthropic.credentials_gated);
        let openai = by("openai");
        assert!(!openai.recommended);
        assert!(!openai.installed);
        assert_eq!(openai.source, "in-use");
        let local = by("local");
        assert_eq!(local.source, "well-known");
        // dedup: anthropic/openai counted once
        assert_eq!(ps.iter().filter(|p| p.name == "anthropic").count(), 1);
    }

    #[test]
    fn empty_agents_yields_well_known_with_anthropic_recommended() {
        let ps = list_providers(&[], &s(&["anthropic"]));
        let names: Vec<&str> = ps.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["anthropic", "openai", "local"]);
        assert!(ps[0].recommended); // anthropic
        assert!(ps[0].installed);
    }
}
```

- [ ] **Step 4: Run + commit**

Run: `cargo test -p tau-gateway --lib providers::tests` → PASS (3 tests). `cargo build -p tau-gateway` clean.

```bash
git add gateway/src/lib.rs gateway/src/providers/mod.rs
git commit -m "feat(gateway): providers composer (available + recommended)"
```

---

## Task 2: AppState wrapper

**Files:** Modify `gateway/src/state.rs`.

- [ ] **Step 1: Add the import** — in the `use` block, after `use crate::projects...`-adjacent crate imports (alphabetically just before `use crate::serve_client`):

```rust
use crate::providers::{self, Provider};
```

- [ ] **Step 2: Add the wrapper** — inside `impl AppState`, right after the existing `list_agents`/`read_agent` methods (anywhere in the impl is fine; place it after `read_agent`):

```rust
    pub fn providers(&self) -> Vec<Provider> {
        let agent_backends: Vec<String> = config::read(&self.0.project)
            .map(|c| c.agents.into_iter().filter_map(|a| a.llm_backend).collect())
            .unwrap_or_default();
        let package_names: Vec<String> = self.packages().into_iter().map(|p| p.name).collect();
        providers::list_providers(&agent_backends, &package_names)
    }
```

(`config` and `self.packages()` are already available on `AppState`; `config::read` returns `ProjectConfig { agents: Vec<AgentInfo> }` where `AgentInfo.llm_backend: Option<String>`.)

- [ ] **Step 3: Run + commit**

Run: `cargo build -p tau-gateway && cargo test -p tau-gateway --lib` → PASS, no regressions.

```bash
git add gateway/src/state.rs
git commit -m "feat(gateway): AppState providers() wrapper"
```

---

## Task 3: API route + integration test

**Files:** Create `gateway/src/api/providers.rs`, `gateway/tests/providers_api.rs`; Modify `gateway/src/api/mod.rs`.

- [ ] **Step 1: Create `gateway/src/api/providers.rs`**

```rust
use axum::Json;

use crate::api::scope::Scoped;
use crate::providers::Provider;

pub async fn list(Scoped(state): Scoped) -> Json<Vec<Provider>> {
    Json(state.providers())
}
```

- [ ] **Step 2: Wire the route in `gateway/src/api/mod.rs`** — add `pub mod providers;` to the module list (alphabetically after `pub mod projects;`, before `pub mod runs;`):

```rust
pub mod projects;
pub mod providers;
pub mod runs;
```

In the scoped router, add the route after the existing `/packages` routes (anywhere in the scoped chain works; place it after `.route("/packages/:name/update", post(packages::update))`):

```rust
        .route("/providers", get(providers::list))
```

(`get` is already imported.)

- [ ] **Step 3: Create `gateway/tests/providers_api.rs`**

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
async fn providers_over_http() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let meta = reg.add_local(&project()).await.unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();

    let resp = http
        .get(format!("{base}/api/projects/{}/providers", meta.id))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let list: serde_json::Value = resp.json().await.unwrap();
    let arr = list.as_array().unwrap();

    // demo agents have no llm_backend → well-known set, anthropic recommended+installed
    let anthropic = arr.iter().find(|p| p["name"] == "anthropic").unwrap();
    assert_eq!(anthropic["recommended"], true);
    assert_eq!(anthropic["installed"], true);
    assert_eq!(anthropic["credentials_gated"], true);
    let openai = arr.iter().find(|p| p["name"] == "openai").unwrap();
    assert_eq!(openai["installed"], false);
}
```

- [ ] **Step 4: Run + commit**

Run: `cargo build -p fake-tau-serve && cargo test -p tau-gateway --test providers_api` → PASS. Confirm `git status --porcelain fixtures/demo` empty.

```bash
git add gateway/src/api/providers.rs gateway/src/api/mod.rs gateway/tests/providers_api.rs
git commit -m "feat(gateway): GET /providers route + integration test"
```

---

## Task 4: ts-rs export + rust gate

**Files:** Regenerated `web/src/types/Provider.ts`.

- [ ] **Step 1: Regenerate** — `cargo build -p fake-tau-serve && cargo test -p tau-gateway` → PASS; `web/src/types/Provider.ts` appears. Confirm `git status --porcelain fixtures/demo` empty.
- [ ] **Step 2: Verify** — `cat web/src/types/Provider.ts` → fields `name, installed, recommended, source, credentials_gated`.
- [ ] **Step 3: Full rust gate** — `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test -p tau-gateway` → green (run `cargo fmt --all` first if needed).
- [ ] **Step 4: Commit**

```bash
git add web/src/types gateway/
git commit -m "chore(gateway): export Provider TS binding + fmt/clippy"
```

---

## Task 5: Frontend — `api/providers.ts` + agent combobox

**Files:** Create `web/src/api/providers.ts`, `web/src/agents/AgentEditorProvider.test.tsx`; Modify `web/src/agents/AgentEditorPage.tsx`.

- [ ] **Step 1: Create `web/src/api/providers.ts`**

```ts
import type { Provider } from "../types/Provider";
import { scopedPath } from "./client";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const getProviders = () => fetch(scopedPath("/providers")).then(json<Provider[]>);
```

- [ ] **Step 2: Write the failing test `web/src/agents/AgentEditorProvider.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AgentEditorPage } from "./AgentEditorPage";

const providers = [
  { name: "anthropic", installed: true, recommended: true, source: "well-known", credentials_gated: true },
  { name: "openai", installed: false, recommended: false, source: "well-known", credentials_gated: true },
];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/providers"))
        return Promise.resolve({ ok: true, json: async () => providers });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }),
  );
});

function renderNew() {
  render(
    <MemoryRouter initialEntries={["/projects/demo/agents/new"]}>
      <Routes>
        <Route path="/projects/:pid/agents/new" element={<AgentEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AgentEditor provider combobox", () => {
  it("offers providers, marks the recommended, and pre-fills a new agent", async () => {
    renderNew();
    // datalist option for a provider
    await waitFor(() => expect(document.querySelector('option[value="anthropic"]')).toBeTruthy());
    expect(document.querySelector('option[value="openai"]')).toBeTruthy();
    // recommended chip
    expect(screen.getByRole("button", { name: /recommended: anthropic/i })).toBeInTheDocument();
    // new agent pre-filled with the recommended provider
    await waitFor(() =>
      expect((screen.getByLabelText("llm backend") as HTMLInputElement).value).toBe("anthropic"),
    );
  });
});
```

- [ ] **Step 3: Modify `web/src/agents/AgentEditorPage.tsx`**

(a) Update the imports at the top:

```tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import type { AgentDetail } from "../types/AgentDetail";
import type { AgentPrompt } from "../types/AgentPrompt";
import type { Provider } from "../types/Provider";
import { getAgent, putAgent, deleteAgent } from "../api/agents";
import { getProviders } from "../api/providers";
import { PromptField } from "./PromptField";
import { RequiresToolsEditor } from "./RequiresToolsEditor";
```

(b) Add provider state + a load/pre-fill effect right after the existing `useState`/`useEffect` block (after the `getAgent` effect, before the `const label = …` line):

```tsx
  const [providers, setProviders] = useState<Provider[]>([]);
  const recommended = providers.find((p) => p.recommended)?.name ?? "";

  useEffect(() => {
    getProviders()
      .then((ps) => {
        setProviders(ps);
        if (isNew) {
          const rec = ps.find((p) => p.recommended)?.name;
          if (rec) setA((prev) => (prev.llm_backend ? prev : { ...prev, llm_backend: rec }));
        }
      })
      .catch(() => {});
  }, [isNew]);
```

(c) Replace the existing `llm_backend` field block:

```tsx
          <div className="w-40">
            <label className={label}>llm_backend</label>
            <input
              aria-label="llm backend"
              className={input}
              placeholder="anthropic"
              value={a.llm_backend ?? ""}
              onChange={(e) => set({ llm_backend: e.target.value || null })}
            />
          </div>
```

with the combobox:

```tsx
          <div className="w-56">
            <label className={label}>llm provider</label>
            <input
              list="llm-providers"
              aria-label="llm backend"
              className={input}
              placeholder="anthropic"
              value={a.llm_backend ?? ""}
              onChange={(e) => set({ llm_backend: e.target.value || null })}
            />
            <datalist id="llm-providers">
              {providers.map((p) => (
                <option key={p.name} value={p.name} />
              ))}
            </datalist>
            <div className="mt-1 flex items-center gap-2">
              {recommended && (
                <button
                  type="button"
                  onClick={() => set({ llm_backend: recommended })}
                  className="rounded-full bg-st-ok-soft px-2 py-0.5 text-[9px] font-semibold text-st-ok"
                  title="use the recommended provider"
                >
                  ✓ recommended: {recommended}
                </button>
              )}
              <Link to={`/projects/${pid}/providers`} className="text-[9px] text-accent">
                ⚙ Manage providers…
              </Link>
            </div>
          </div>
```

(The `⚙ Manage providers…` link targets `/providers`, which Plan 2 adds. Until then it routes to the home redirect — acceptable in the interim.)

- [ ] **Step 4: Run + commit**

Run: `cd web && pnpm test -- src/agents/AgentEditorProvider.test.tsx && pnpm test && pnpm typecheck` → all green. (If the pre-existing `AgentEditorPage.test.tsx` breaks because a new agent now pre-fills `llm_backend`, update that test's expectation minimally and include it in the commit; the `aria-label="llm backend"` is unchanged so most assertions still hold.)

```bash
git add web/src/api/providers.ts web/src/agents/AgentEditorPage.tsx web/src/agents/AgentEditorProvider.test.tsx
git commit -m "feat(web): agent editor provider combobox (datalist + recommended + pre-fill)"
```

---

## Task 6: E2e + final gate

**Files:** Modify `web/e2e/run.spec.ts`.

- [ ] **Step 1: Append the spec**

```ts
test("agents: provider combobox shows the recommended provider", async ({ page }) => {
  await page.goto("/projects/demo/agents/new");
  await expect(page.getByLabel("agent id")).toBeVisible({ timeout: 5000 });
  // the recommended chip (anthropic — demo agents have no backend set)
  await expect(page.getByRole("button", { name: /recommended: anthropic/i })).toBeVisible();
  // and the field pre-filled with it
  await expect(page.getByLabel("llm backend")).toHaveValue("anthropic");
});
```

- [ ] **Step 2: Kill stale servers, rebuild, run e2e**

```bash
lsof -nP -iTCP:4317 -iTCP:5173 -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null; sleep 1
cargo build -p tau-gateway -p fake-tau-serve
cd web && pnpm exec playwright test
```
Expected: ALL pass. Real ASSERTION failure → STOP, report BLOCKED. Missing-browser → `pnpm exec playwright install chromium` then retry; else `pnpm exec playwright test --list` and note e2e deferred to CI.

- [ ] **Step 3: Restore fixtures**

```bash
cd /Users/titouanlebocq/code/tau-ui
git checkout fixtures/demo/tau.toml docs/verification/trace-complete.png 2>/dev/null
git clean -fd fixtures/demo/skills >/dev/null 2>&1; git checkout fixtures/demo/skills 2>/dev/null
git status --porcelain fixtures/demo   # must be empty
true
```

- [ ] **Step 4: Full web gate** — `cd /Users/titouanlebocq/code/tau-ui/web && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` → green (run `pnpm format` if format:check fails, include it).

- [ ] **Step 5: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/e2e/run.spec.ts
# include any prettier-formatted source (git status)
git commit -m "test(web): e2e agent provider combobox"
```

---

## Self-Review

**Spec coverage** (the A + shared-providers portions of `2026-06-02-agent-providers-and-node-display-design.md`):
- §2 `Provider` type + `list_providers` composer (available union, recommended modal-else-anthropic, installed = package membership, credentials_gated) → Task 1. AppState `providers()` → Task 2. `GET /providers` → Task 3. ts-rs → Task 4. §4.1 `api/providers.ts` + §4.2 agent combobox (datalist, recommended chip, pre-fill, Manage-providers link) → Task 5. Tests → Tasks 1, 3, 5, 6. **Deferred to Plan 2/3:** the Providers screen (D) and the workflow node provider/tools enrichment + canvas (B) — those consume `getProviders()`/`recommended_backend` built here.

**Placeholder scan:** none.

**Type consistency:** `Provider { name, installed, recommended, source, credentials_gated }` is identical across the Rust struct, the ts-rs export, `api/providers.ts`, and `AgentEditorPage`. `list_providers(&[String], &[String])` + `recommended_backend(&[String])` signatures match their `AppState::providers()` caller. The combobox keeps `aria-label="llm backend"` so existing queries hold; `getProviders()` → `Provider[]` via `scopedPath("/providers")` matches the `GET /providers` route.

**Note for executor:** read-only — `GET /providers` reads config + packages (no writes), so `git status --porcelain fixtures/demo` stays clean. The agent combobox pre-fills a **new** agent's `llm_backend`; if the pre-existing `AgentEditorPage.test.tsx` asserts an empty backend on a new agent, update that one expectation (Task 5 Step 4). The "Manage providers" link points at `/providers` (Plan 2); harmless until then.
