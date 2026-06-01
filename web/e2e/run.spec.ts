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
