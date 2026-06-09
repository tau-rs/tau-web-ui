import { test, expect } from "@playwright/test";

const P = "/projects/demo";

test("launch a run and watch the live trace build", async ({ page }) => {
  await page.goto(`${P}/runs`);
  await expect(page.getByLabel("agent")).toContainText("greeter");

  await page.getByLabel("prompt").fill("hello from e2e");
  const t0 = Date.now();
  await page.getByRole("button", { name: "Run" }).click();

  await expect(page.getByText(/Hello!/)).toBeVisible({ timeout: 1500 });
  const firstPaint = Date.now() - t0;
  expect(firstPaint).toBeLessThan(1500);

  await expect(page.getByText("fs-read")).toBeVisible();
  await page.getByText("fs-read").click();
  await expect(page.getByText(/"path"/)).toBeVisible();

  await expect(page.getByText("completed")).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/tok/)).toBeVisible();

  await page.screenshot({ path: "../docs/verification/trace-complete.png", fullPage: true });

  await page.getByRole("button", { name: /back to runs/i }).click();
  await page.locator("table tbody tr").first().click();
  await expect(page.getByText("fs-read")).toBeVisible();

  // Deep-link / hard refresh: the trace URL must re-scope on a cold load
  // (regression guard for the active-project prefix being set on first paint).
  await page.reload();
  await expect(page.getByText("fs-read")).toBeVisible({ timeout: 5000 });
});

test("cancel mid-run", async ({ page }) => {
  await page.goto(`${P}/runs`);
  await page.getByLabel("prompt").fill("long run");
  await page.getByRole("button", { name: "Run" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("cancelled")).toBeVisible({ timeout: 5000 });
});

test("launch a workflow and watch the step trace", async ({ page }) => {
  await page.goto(`${P}/runs`);
  await page.getByRole("button", { name: "Workflow", exact: true }).click();
  await page.getByLabel("workflow").selectOption("nightly-research");
  await page.getByLabel("prompt").fill("q3 churn");
  await page.getByRole("button", { name: "Run" }).click();

  await expect(page.getByText("gather")).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("save-results")).toBeVisible({ timeout: 5000 });

  await page.getByText("gather").click();
  await expect(page.getByText(/view agent trace/i)).toBeVisible();
  await expect(page.getByText("completed")).toBeVisible({ timeout: 5000 });
});

test("config + packages surfaces work", async ({ page }) => {
  await page.goto(`${P}/packages`);
  await expect(page.getByRole("cell", { name: "anthropic", exact: true })).toBeVisible({
    timeout: 5000,
  });
  await page.getByLabel("install git url").fill("https://github.com/acme/cooltool.git");
  await page.getByRole("button", { name: "Install", exact: true }).click();
  await expect(page.getByRole("cell", { name: "cooltool", exact: true })).toBeVisible({
    timeout: 5000,
  });

  await page.goto(`${P}/config`);
  await expect(page.getByLabel("project name")).toBeVisible({ timeout: 5000 });
  await page.getByLabel("import git url").fill("https://github.com/acme/researcher-pro.git");
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByRole("cell", { name: "researcher-pro", exact: true })).toBeVisible({
    timeout: 5000,
  });
});

test("projects home lists the project and links into it", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /^projects$/i })).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: /demo/ }).first().click();
  await expect(page).toHaveURL(/\/projects\/demo\/dashboard/);
});

test("add a project by path from the home", async ({ page }) => {
  await page.goto("/");
  // Relative path: the gateway canonicalizes it against its own cwd (repo root).
  await page.getByLabel("project path").fill("fixtures/demo");
  await page.getByRole("button", { name: "Add path" }).click();
  await expect(page.getByText(/failed to add/i)).toHaveCount(0);
});

test("create, edit, and delete an agent", async ({ page }) => {
  await page.goto("/projects/demo/agents");
  await expect(page.getByRole("heading", { name: /^agents$/i })).toBeVisible({ timeout: 5000 });

  // create
  await page.getByRole("link", { name: /new agent/i }).click();
  await page.getByLabel("agent id").fill("e2e-bot");
  await page.getByLabel("display name").fill("E2E Bot");
  await page.getByLabel("llm backend").fill("anthropic");
  await page.getByLabel("system prompt").fill("you are an e2e bot");
  await page.getByRole("button", { name: "+ Add tool" }).click();
  await page.getByLabel("tool name 0").fill("fs-read");
  await page.getByLabel("tool source 0").fill("https://example.com/fs-read.git");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // back in the index, the new agent appears
  await page.goto("/projects/demo/agents");
  await expect(page.getByRole("link", { name: "e2e-bot" })).toBeVisible({ timeout: 5000 });

  // edit the prompt
  await page.getByRole("link", { name: "e2e-bot" }).click();
  await expect(page.getByLabel("display name")).toHaveValue("E2E Bot");
  await page.getByLabel("system prompt").fill("updated prompt");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // delete
  await page.goto("/projects/demo/agents/e2e-bot");
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("link", { name: "e2e-bot" })).toHaveCount(0);
});

test("skills: create, edit, delete, import", async ({ page }) => {
  await page.goto("/projects/demo/tools");
  await expect(page.getByRole("heading", { name: /tools & skills/i })).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByRole("link", { name: "critic" })).toBeVisible();

  // create a new skill
  await page.getByRole("link", { name: /new skill/i }).click();
  await page.getByLabel("skill name").fill("e2e-skill");
  await page.getByLabel("description").fill("e2e skill");
  await page.getByLabel("SKILL.md body").fill("you do e2e things");
  await page.getByRole("button", { name: "+ Add capability" }).click();
  await page.getByLabel("paths 0").fill("/tmp/**");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // appears in the index
  await page.goto("/projects/demo/tools");
  await expect(page.getByRole("link", { name: "e2e-skill" })).toBeVisible({ timeout: 5000 });

  // edit + save
  await page.getByRole("link", { name: "e2e-skill" }).click();
  await expect(page.getByLabel("description")).toHaveValue("e2e skill");
  await page.getByLabel("SKILL.md body").fill("updated body");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // import an installed skill
  await page.goto("/projects/demo/tools");
  await page.getByLabel("import skill git url").fill("https://github.com/acme/translator.git");
  await page.getByRole("button", { name: "Import skill" }).click();
  await expect(page.getByRole("link", { name: "translator" })).toBeVisible({ timeout: 5000 });

  // delete the created skill
  await page.goto("/projects/demo/tools/skills/e2e-skill");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("link", { name: "e2e-skill" })).toHaveCount(0);
});

test("nav shell on the overview + workspace save-as", async ({ page }) => {
  await page.goto("/");
  // shell is present on the overview; scoped groups are greyed (Dashboard is not a link)
  await expect(page.getByRole("link", { name: /projects/i }).first()).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByRole("link", { name: /^dashboard$/i })).toHaveCount(0);

  // the Unsaved card is present; enter the workspace
  await expect(page.getByText(/working environment/i)).toBeVisible();
  await page.getByText(/working environment/i).click();
  await expect(page).toHaveURL(/\/projects\/workspace\/dashboard/);
  // inside the workspace the scoped nav is live
  await expect(page.getByRole("link", { name: /^agents$/i })).toBeVisible({ timeout: 5000 });

  // author an agent in the workspace
  await page.goto("/projects/workspace/agents/new");
  await page.getByLabel("agent id").fill("ws-bot");
  await page.getByLabel("system prompt").fill("hi");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // save the workspace as a real project from the navbar affordance
  await page.getByLabel("save as project").click();
  await page.getByLabel("project name").fill("e2e saved " + Date.now());
  // Use last() because the regex also matches the trigger button that opened this form
  await page
    .getByRole("button", { name: /save as project/i })
    .last()
    .click();

  // we land in the new project, and it has the agent
  await expect(page).toHaveURL(/\/projects\/[^/]+\/dashboard/);
  await page.goto(page.url().replace("/dashboard", "/agents"));
  await expect(page.getByRole("link", { name: "ws-bot" })).toBeVisible({ timeout: 5000 });
});

test("tools tab: list + expand shows used_by", async ({ page }) => {
  await page.goto("/projects/demo/tools");
  await page.getByRole("button", { name: /^tools$/i }).click();
  await expect(page.getByRole("button", { name: /fs-read/i })).toBeVisible({ timeout: 5000 });
  // expand fs-read → capability field detail + used-by critic (the seeded skill requires it)
  await page.getByRole("button", { name: /fs-read/i }).click();
  await expect(page.getByText(/paths=\[/)).toBeVisible();
  await expect(page.getByText("critic")).toBeVisible();
});

test("plugins tab: gated, two-pane describe + protocol-decode", async ({ page }) => {
  await page.goto("/projects/demo/tools");
  await page.getByRole("button", { name: /plugins/i }).click();
  await expect(page.getByText(/mock data/i)).toBeVisible({ timeout: 5000 });
  // select the LlmBackend plugin → its transcript has llm.generate
  await page.getByRole("button", { name: /^anthropic/i }).click();
  const frame = page.getByRole("button", { name: /llm\.generate/i });
  await expect(frame).toBeVisible();
  // expand the frame → pretty JSON payload visible. Match the spaced ("model": …)
  // pretty form so we target the expanded <pre>, not the one-line preview.
  await frame.click();
  await expect(page.getByText(/"model": "claude-opus-4"/)).toBeVisible();
});

test("ship: targets, build host, new bundle with steps", async ({ page }) => {
  await page.goto("/projects/demo/ship");
  // host target card rendered (assert the substrate — "host" also appears as a
  // select option + bundle target cell; Playwright resolves /native/ to the card).
  await expect(page.getByText(/native/)).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("button", { name: /^build$/i })).toBeVisible();
  await page.getByRole("button", { name: /^build$/i }).click();
  // the build step timeline renders (compile is unique to the timeline)
  await expect(page.getByText("compile")).toBeVisible({ timeout: 5000 });
});

test("health: checks findings + filter + gated conformance", async ({ page }) => {
  await page.goto("/projects/demo/health");
  await expect(page.getByText("TAU-CONFIG-ENDPOINT")).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/waits on tau β\.6/i)).toBeVisible();
  // filter by the lockfile chip → the config error finding disappears
  await page.getByRole("button", { name: /lockfile/i }).click();
  await expect(page.getByText("TAU-LOCK-STALE")).toBeVisible();
  await expect(page.getByText("TAU-CONFIG-ENDPOINT")).toHaveCount(0);
});

test("workflows: graph editor renders + edit mode is gated", async ({ page }) => {
  await page.goto("/projects/demo/workflows");
  await expect(page.getByRole("combobox", { name: /workflow/i })).toBeVisible({ timeout: 5000 });
  // React Flow rendered the workflow nodes (assert the canvas node class — "gather"
  // text appears in both the canvas and the inspector, so don't match on it).
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 5000 });
  // enter edit mode → local banner + the gated Build button
  await page.getByRole("button", { name: /^edit$/i }).click();
  await expect(page.getByText(/changes are local/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /build from ir/i })).toBeDisabled();
});

test("agents: provider combobox shows the recommended provider", async ({ page }) => {
  await page.goto("/projects/demo/agents/new");
  await expect(page.getByLabel("agent id")).toBeVisible({ timeout: 5000 });
  // the recommended chip (anthropic — demo agents have no backend set)
  await expect(page.getByRole("button", { name: /recommended: anthropic/i })).toBeVisible();
  // and the field pre-filled with it
  await expect(page.getByLabel("llm backend")).toHaveValue("anthropic");
});

test("providers: screen lists anthropic installed with a gated Set API key", async ({ page }) => {
  await page.goto("/projects/demo/providers");
  await expect(page.getByRole("heading", { name: "Providers" })).toBeVisible({ timeout: 5000 });
  // the anthropic row: installed + recommended, and a disabled (gated) Set API key
  const row = page.getByRole("row").filter({ hasText: "anthropic" });
  await expect(row.getByText("✓ installed")).toBeVisible();
  await expect(row.getByText("✓ recommended")).toBeVisible();
  await expect(row.getByRole("button", { name: /Set API key/i })).toBeDisabled();
});

test("workflows: graph shows provider pill on an agent node + a minimap", async ({ page }) => {
  await page.goto("/projects/demo/workflows");
  // the React Flow canvas renders nodes (gated editor still displays the graph)
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 5000 });
  // an agent.run node carries a provider pill (demo agents resolve to anthropic)
  await expect(page.getByText(/⚡ anthropic/).first()).toBeVisible();
  // Level-2 chrome: the minimap renders
  await expect(page.locator(".react-flow__minimap")).toBeVisible();
  // Save → IR remains gated
  await expect(page.getByRole("button", { name: /build from ir/i })).toBeDisabled();
});

test("workflows: edit mode adds a step via the inline + and palette", async ({ page }) => {
  await page.goto("/projects/demo/workflows");
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 5000 });
  const before = await page.locator(".react-flow__node").count();
  // enter edit mode
  await page.getByRole("button", { name: /^edit$/i }).click();
  // hover the first node to reveal its inline "+", then click it
  const node = page.locator(".react-flow__node").first();
  await node.hover();
  await node.getByRole("button", { name: "add next step" }).click();
  // the searchable palette opens; pick agent.run
  await expect(page.getByRole("dialog", { name: "add step" })).toBeVisible();
  await page.getByRole("button", { name: "agent.run" }).click();
  // a node was added
  await expect(page.locator(".react-flow__node")).toHaveCount(before + 1);
  // Save → IR stays gated
  await expect(page.getByRole("button", { name: /build from ir/i })).toBeDisabled();
});
