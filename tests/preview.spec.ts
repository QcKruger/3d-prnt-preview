import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("renders the site without browser errors or horizontal overflow", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Imagine it.",
  );
  await expect(page.locator(".brand-logo img").first()).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".brand-logo img")
        .first()
        .evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("preview.png") });
});

test("filters, searches, and sorts the catalogue", async ({ page }) => {
  await page
    .getByRole("button", { name: "Desk & Office", exact: true })
    .click();
  await expect(page.locator("#results")).toHaveText("2 products found");
  await page.getByLabel("Sort products", { exact: true }).selectOption("low");
  await expect(page.locator(".product h3").first()).toHaveText(
    "Cable Organiser",
  );
  await page.getByLabel("Search products", { exact: true }).fill("headphone");
  await expect(page.locator(".product")).toHaveCount(1);
  await expect(page.locator(".product h3")).toHaveText("Headphone Stand");
  await page
    .getByLabel("Search products", { exact: true })
    .fill("missing product");
  await expect(page.locator(".no-results")).toBeVisible();
});

test("adds product quantities, enables sandbox checkout, and removes cart items", async ({
  page,
}) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) apiRequests.push(request.url());
  });
  await page
    .getByRole("button", {
      name: "View Geometric Planter details",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Geometric Planter",
    exact: true,
  });
  await dialog.getByLabel("Quantity", { exact: true }).fill("2");
  await dialog.getByRole("button", { name: /ADD TO CART/ }).click();
  const cart = page.getByRole("dialog", { name: /Your cart/ });
  await expect(cart.locator(".cart-item")).toHaveCount(2);
  await expect(cart.locator("#cartTotal")).toHaveText("R378");
  await cart.getByRole("button", { name: /REVIEW CHECKOUT/ }).click();
  await expect(
    cart.getByRole("button", { name: /CONTINUE TO PAYFAST/ }),
  ).toBeEnabled();
  await expect(
    cart.getByText(/Sandbox test checkout · no real payment/),
  ).toBeVisible();
  expect(apiRequests.filter((url) => url.includes("/api/payment/"))).toEqual([
    expect.stringContaining("/api/payment/config"),
  ]);
  await cart.getByRole("button", { name: /Back to cart/ }).click();
  await cart
    .getByRole("button", { name: "Remove Geometric Planter from cart" })
    .first()
    .click();
  await expect(cart.locator("#cartTotal")).toHaveText("R189");
  await page.keyboard.press("Escape");
  await expect(cart).not.toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Open cart, 0 items" }).click();
  await expect(page.locator(".empty")).toBeVisible();
});

test("validates an enquiry and downloads a brief without submitting or uploading", async ({
  page,
}, testInfo) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" || request.url().includes("/api/"))
      apiRequests.push(request.url());
  });
  if (testInfo.project.name === "mobile")
    await page.locator("#custom summary").click();
  const save = page.getByRole("button", { name: /SAVE ENQUIRY BRIEF/ });
  await save.click();
  await expect(page.locator("#error-name")).toBeVisible();
  await page
    .locator("#custom")
    .getByLabel("Your name *", { exact: true })
    .fill("Preview Tester");
  await page
    .locator("#custom")
    .getByLabel("Email address *", { exact: true })
    .fill("tester@example.com");
  await page
    .getByLabel("Your idea or requirements *", { exact: true })
    .fill("A custom enclosure for a small electronics project.");
  await page.locator("#file").setInputFiles({
    name: "model.stl",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("solid model\nendsolid model"),
  });
  const downloadPromise = page.waitForEvent("download");
  await save.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("3d-prnt-enquiry.txt");
  const filename = await download.path();
  expect(filename).not.toBeNull();
  const brief = await readFile(filename!, "utf8");
  expect(brief).toContain("Name: Preview Tester");
  expect(brief).toContain("Model filename: model.stl");
  expect(brief).toContain("This brief has not been sent.");
  await expect(page.locator(".form-success")).toBeVisible();
  expect(apiRequests.filter((url) => !url.includes("/api/content"))).toEqual(
    [],
  );
});

test("rejects invalid and empty model files", async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile")
    await page.locator("#custom summary").click();
  await page.locator("#file").setInputFiles({
    name: "model.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("invalid"),
  });
  await expect(page.locator('.model-upload [role="alert"]')).toHaveText(
    "Please choose an STL, OBJ or 3MF file.",
  );
  await page.locator("#file").setInputFiles({
    name: "model.stl",
    mimeType: "application/octet-stream",
    buffer: Buffer.alloc(0),
  });
  await expect(page.locator('.model-upload [role="alert"]')).toContainText(
    "This file is empty.",
  );
});

test("mobile navigation and compact catalogue work", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile");
  await expect(page.locator(".product")).toHaveCount(4);
  await page.getByRole("button", { name: /SHOW ALL 8 PRODUCTS/ }).click();
  await expect(page.locator(".product")).toHaveCount(8);
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("link", { name: "Shop products" })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).not.toBeVisible();
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open navigation", exact: true }),
  ).toBeFocused();
});
