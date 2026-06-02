# Agent providers + workflow node display — design

**Status:** approved (brainstorm 2026-06-02)
**Relates to:** Product IA surfaces ① (Author — Agents, Workflows) and ② (Configure). Three linked pieces in one spec.
**Next sub-project (explicit roadmap):** **Credentials handling** (the tau β.5 credentials chain) — picks up exactly where this spec's gated "Set API key" affordance + the documented `POST /providers/:name/credentials` seam leave off.

## 1. Goal

Three linked improvements sharing one **providers** data source:

- **A — Agent provider field.** Replace the agent editor's free-text `llm_backend` `<input>` with an **editable combobox** (a native `<input list>` + `<datalist>` of available providers, still free-typeable) carrying a **✓ recommended** chip (clickable to apply), a new agent **pre-filled** with the recommended provider, and a **"⚙ Manage providers…"** entry that routes to the new Providers screen.
- **B — Workflow graph node + canvas (n8n-grade).** A best-in-class canvas pass on the (gated) workflow graph editor, in four stacked levels: **(1)** icon-forward step nodes (kind icon + title + a **provider pill** for `agent.run`) with styled handles + selection ring; **(2)** a per-node **hover toolbar** (inspect; in edit mode: disable/duplicate/delete) + a **minimap** and **zoom controls**; **(3)** **inline add/insert** — a `+` on a node's output adds & connects the next step, a `+` on an edge inserts a step between (edit mode); **(4)** a **searchable add-step palette** on `+` (agent.run / tool.call / an agent by name). The inspector is enriched with provider (+ recommended marker) · tools · input. The gateway resolves each `agent.run` step → its provider/tools from the agent config. All edit actions remain **local-only**; Save → IR stays **gated** (unchanged from the shipped editor).
- **D — Providers screen.** A new `/projects/:pid/providers` surface: a table of LLM providers with per-provider **status** (source · installed · recommended · credentials), an **Add provider** action (reusing the existing package install), and a per-provider **"🔒 Set API key"** affordance that is **gated** (tau β.5 credentials chain).

All three read one gateway providers composer, so the available-providers list and the recommendation are computed once, from **real project data**, and stay consistent across the agent editor, the graph nodes, and the Providers screen.

Locked decisions (brainstorm):
- Provider field = **typeable combobox** (datalist), not a hard select — keeps today's free-text freedom.
- Workflow canvas = **n8n-grade, all four levels** (icon nodes + provider · hover toolbar + minimap/zoom · inline `+` add & edge-insert · searchable add-step palette). React Flow built-ins (`<NodeToolbar>`, `<MiniMap>`, `<Controls>`, custom edge via `EdgeLabelRenderer`) cover it; no new library. Interaction *logic* (insert-between, add-next) lives in **pure, unit-tested helpers**; the live canvas is covered by e2e. Edits remain local-only; Save → IR gated.
- **Recommended** = the **modal** backend across the project's agents (most-used), falling back to `anthropic` when no agent has one set. (There is no project-level `llm_backend` field; recommendation comes from real agent config.)
- **Installed** = provider name ∈ installed package names (so `anthropic`, an installed package, shows installed; "Add provider" = the existing package install flips it). No change to the package model.
- Credentials are **gated** (only the API-key step); everything else on the Providers screen is real.

## 2. Providers data model + composer (gateway)

```rust
// gateway/src/providers/mod.rs

#[derive(Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Provider {
    pub name: String,
    pub installed: bool,          // name ∈ installed package names
    pub recommended: bool,        // name == the resolved recommended backend
    pub source: String,           // "in-use" | "well-known"
    pub credentials_gated: bool,  // true in v1 (β.5)
}
```

**Composer** `list_providers(agent_backends: &[String], package_names: &[String]) -> Vec<Provider>` (pure, testable):
- `in_use` = unique non-empty `agent_backends` (each agent's `llm_backend`).
- `well_known` = `["anthropic", "openai", "local"]` (a small constant).
- listed names = `in_use ∪ well_known` (dedup, stable order: recommended first, then in-use, then well-known, alpha within).
- `recommended` name = the **mode** of `in_use` (most frequent); if `in_use` is empty → `"anthropic"`.
- per provider: `installed = name ∈ package_names`; `recommended = name == recommended_name`; `source = in_use.contains(name) ? "in-use" : "well-known"`; `credentials_gated = true`.

**AppState** gains `pub fn providers(&self) -> Vec<Provider>`, reading `config::read(project)` (the agents + their backends) and `self.packages()` (installed names), then calling the composer. The recommended name is also exposed (helper `recommended_backend(&self) -> String`) for reuse by B and A's pre-fill.

**API:** one scoped route — `GET /api/projects/:pid/providers → Json<Vec<Provider>>` (`api::providers::list`).

## 3. Workflow node enrichment (gateway, for B)

`WorkflowNode` (in `gateway/src/graph/mod.rs`) gains two fields:

```rust
pub provider: Option<String>,  // agent.run: the agent's llm_backend, else the recommended backend
pub tools: Vec<String>,        // agent.run: the agent's requires_tools names
```

`AppState::workflow_graph(name)` becomes a small **composer**: it gets the base structural graph from `graph_source` (the existing `MockGraph`), then for each `agent.run` node with an `agent`, resolves via `config::read_agent(project, agent)`:
- `provider = agent.llm_backend.or(Some(recommended_backend()))`,
- `tools = agent.requires_tools.iter().map(|t| t.name).collect()`.
`tool.call` nodes leave `provider = None`, `tools = []`. (This ties A→B: editing an agent's provider changes its node; the demo agents — which have no backend — show the recommended `anthropic`.)

## 4. Frontend

### 4.1 Shared API
`web/src/api/providers.ts`: `getProviders(): Promise<Provider[]>` → `GET /providers` (scoped; the ok-checking `json<T>` helper). Used by A and D.

### 4.2 A — Agent editor (`web/src/agents/AgentEditorPage.tsx`)
- Replace the `llm_backend` `<input>` with `<input list="llm-providers" aria-label="llm backend">` + a `<datalist id="llm-providers">` of `getProviders()` names — typeable **and** pickable.
- A **✓ recommended** chip beside the field (green, clickable → sets the field to the recommended provider); a small `source` hint.
- On **new agent** (no `llm_backend` yet), pre-fill with the recommended provider.
- A **"⚙ Manage providers…"** link (routes to `/projects/:pid/providers`).

### 4.3 B — Graph node + canvas (`web/src/graph/`), n8n-grade (four levels)
- **Level 1 — icon node.** `StepNode.tsx` → icon-forward: a kind icon square (agent.run = accent gradient, tool.call = `st-running`/blue) + title (step label) + subtitle (agent.run → agent name + a **provider pill** `⚡ <provider>`; tool.call → tool name + cap); styled left/right handles; selection ring. `layout.ts` `StepNodeData` gains `provider: string | null` + `tools: string[]`; `workflowToFlow` passes them through.
- **Level 2 — hover toolbar + chrome.** A React Flow `<NodeToolbar>` shown on node hover/select: an **inspect** action (focuses the inspector) always; **disable · duplicate · delete** only in edit mode. Add `<MiniMap>` + `<Controls>` to `GraphCanvas`.
- **Level 3 — inline add/insert (edit mode).** A `+` affordance on a node's source handle that **adds & connects** a new step; a **custom edge** (`EdgeLabelRenderer`) with a midpoint `+` that **inserts** a step between two nodes (rewires the edge → two edges). The graph mutations are pure helpers in `web/src/graph/edit.ts` — `addNextStep(nodes, edges, fromId, kind)` and `insertStepOnEdge(nodes, edges, edgeId, kind)` — returning new `{nodes, edges}` (unit-tested); the canvas just calls them.
- **Level 4 — add-step palette.** Clicking a `+` opens a small searchable popover (`StepPalette.tsx`): pick `agent.run`, `tool.call`, or filter to a specific agent by name (from the agents list) → calls the Level-3 helper with the chosen kind/agent. (Default kind when dismissed: `agent.run`.)
- `GraphEditor.tsx` inspector (view mode): a **provider** row (with a `✓ recommended` marker when it equals the recommended), a **tools** row (pills), keep input. New nodes/edges from Levels 3–4 live in local state only; **Save → IR stays gated** (no persistence).

### 4.4 D — Providers screen (`web/src/providers/ProvidersPage.tsx`)
- New route `/projects/:pid/providers` (`App.tsx`); new **Sidebar** nav item "Providers" in the Build group (near Packages/Config), un-gated (the surface is real; only the credentials step is gated in-row).
- Renders a table from `getProviders()`: **name** · **source** badge · **installed** badge (✓ / "not installed") · **recommended** badge · a per-row gated **"🔒 Set API key"** button (disabled, amber, title "waits on tau β.5").
- An **Add provider** control: an install-by-git-URL input + button reusing the existing `packageInstall` (`POST /packages/install`); on success it re-fetches providers (a matching well-known/in-use name flips to installed). A note explains that a fully custom backend can also just be typed in an agent's provider field.

## 5. Testing

**Gateway:**
- Unit (`providers/mod.rs`): `list_providers` — available = `in_use ∪ well_known` (dedup); recommended = mode of in-use, else `anthropic`; `installed` reflects package membership; `credentials_gated == true`. Sorting (recommended first).
- Unit (`graph` composer): an `agent.run` node resolves `provider` (agent backend or recommended) + `tools`; a `tool.call` node has `provider == None`.
- Integration: `GET /providers` returns the array (anthropic present, installed, recommended-or-not); `GET …/workflows/nightly-research/graph` nodes carry `provider`.

**Web (vitest):**
- AgentEditor: the provider field is a combobox with a `<datalist>` of provider names incl. the recommended; new-agent pre-fill; the "Manage providers" link; typing a custom value still works.
- StepNode/inspector: an agent node shows its provider pill; the inspector shows provider + tools.
- **Graph edit helpers** (`graph/edit.ts`, pure): `addNextStep` appends a node + a connecting edge from the source; `insertStepOnEdge` replaces an edge A→B with A→new→B (one node added, edge count net +1). Unit-tested directly (the canvas/React-Flow interactions are not asserted in jsdom — covered by e2e).
- `StepPalette`: renders the kind options + filters agents by the search term.
- ProvidersPage: renders the providers table; the "🔒 Set API key" button is **disabled**; the Add-provider control posts an install.

**E2e (Playwright):**
- Agent editor → the provider combobox shows the recommended marker.
- `/projects/demo/providers` → `anthropic` row shows installed + the gated "Set API key" (disabled).
- Workflow graph: a node shows a provider pill; the minimap renders; in **edit mode**, clicking a node's `+` (then the palette) adds a new `.react-flow__node` (node count increases); the gated Build button stays disabled.

## 6. ts-rs / CI
`Provider` and the two new `WorkflowNode` fields export to `web/src/types` via `#[ts(export)]` + the drift gate. No CI job changes.

## 7. Out of scope (YAGNI) / roadmap

- **Credentials handling — the explicit NEXT sub-project.** Real credential capture/storage (the tau β.5 credentials chain) is *not* built here: the per-provider **"Set API key"** is gated/disabled, and `POST /api/projects/:pid/providers/:name/credentials` is a **documented seam** (no endpoint in v1). The next sub-project fills exactly this seam.
- **Per-package "recommended backend" metadata** — tau has none; the recommendation stays modal-from-real-config. The `recommended_backend` logic is a single composer point, so a future package-level recommendation is a localized change.
- **A package `kind` field / true backend-vs-tool classification** — not needed: "installed" is a name match against installed packages; truly-custom backends are typed in the agent combobox.
- **Non-determinism representation (C)** — the agreed sub-project *after* credentials handling; tau's static workflow model can't express branch/loop/fan-out yet (β.2 IR).
- **Per-provider endpoint editing on the Providers screen** — the inference endpoint stays on the Config surface; the Providers screen links there rather than duplicating it.
