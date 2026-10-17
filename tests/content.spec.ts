import { test, expect } from "@playwright/test";
import { emptyContent } from "../src/content";
import { localContent } from "../server/local-content";

test("content appears after recovery, clears on failure and stays empty without database records", async ({
  page,
}) => {
  let state: "empty" | "ready" | "offline" = "empty";
  const cloud = {
    ...localContent,
    products: [
      { ...localContent.products[0], name: "Cosmos-only product", price: 321 },
    ],
  };
  await page.clock.install();
  await page.route("**/api/content", (route) =>
    route.fulfill({
      status: state === "offline" ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(state === "ready" ? cloud : emptyContent()),
    }),
  );
  await page.goto("/");
  await expect(page.locator("#shop")).toHaveCount(0);
  await expect(page.locator("#services")).toHaveCount(0);
  await expect(page.locator("#faq")).toHaveCount(0);
  state = "ready";
  await page.clock.runFor(10_100);
  await expect(
    page.getByRole("button", {
      name: "Add Cosmos-only product to cart",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Geometric Planter", { exact: true }),
  ).toHaveCount(0);
  state = "offline";
  await page.clock.runFor(10_100);
  await expect(page.locator("#shop")).toHaveCount(0);
  await expect(page.locator("#services")).toHaveCount(0);
  state = "ready";
  await page.clock.runFor(10_100);
  await expect(page.locator("#shop")).toHaveCount(1);
  state = "empty";
  await page.clock.runFor(10_100);
  await expect(page.locator("#shop")).toHaveCount(0);
});
