import { test, expect } from "@playwright/test";

test("launch a run and watch the live trace build", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("agent")).toContainText("greeter");

  await page.getByLabel("prompt").fill("hello from e2e");
  const t0 = Date.now();
  await page.getByRole("button", { name: "Run" }).click();

  // AC#2 — first streamed text appears quickly.
  await expect(page.getByText(/Hello!/)).toBeVisible({ timeout: 1500 });
  const firstPaint = Date.now() - t0;
  expect(firstPaint).toBeLessThan(1500);

  // AC#3 — a tool-call node appears.
  await expect(page.getByText("fs-read")).toBeVisible();
  await page.getByText("fs-read").click();
  await expect(page.getByText(/"path"/)).toBeVisible();

  // AC#4 — completion.
  await expect(page.getByText("completed")).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/tok/)).toBeVisible();

  // AC#9 — evidence.
  await page.screenshot({ path: "../docs/verification/trace-complete.png", fullPage: true });

  // AC#5 — reopen replays.
  await page.getByRole("button", { name: /back to runs/i }).click();
  // Click the "greeter" agent cell in the runs table (not the hidden <option>).
  await page.locator("table tbody tr").first().click();
  await expect(page.getByText("fs-read")).toBeVisible();
});

test("cancel mid-run", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("prompt").fill("long run");
  await page.getByRole("button", { name: "Run" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("cancelled")).toBeVisible({ timeout: 5000 });
});

test("launch a workflow and watch the step trace", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Workflow", exact: true }).click();
  await page.getByLabel("workflow").selectOption("nightly-research");
  await page.getByLabel("prompt").fill("q3 churn");
  await page.getByRole("button", { name: "Run" }).click();

  // step trace builds (Timeline default for workflows)
  await expect(page.getByText("gather")).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("save-results")).toBeVisible({ timeout: 5000 });

  // a workflow agent step shows the gated drill
  await page.getByText("gather").click();
  await expect(page.getByText(/view agent trace/i)).toBeVisible();
  await expect(page.getByText("completed")).toBeVisible({ timeout: 5000 });
});
