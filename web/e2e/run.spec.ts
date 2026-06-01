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
