import { expect, test } from "@playwright/test";

test("delivery checkout includes the configured fee and its private link opens a safe guest status view", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Add Geometric Planter to cart", exact: true })
    .click();
  const cart = page.getByRole("dialog", { name: /Your cart/ });
  await cart.getByRole("button", { name: /REVIEW CHECKOUT/ }).click();
  await cart.getByLabel("First name", { exact: true }).fill("Test");
  await cart.getByLabel("Surname", { exact: true }).fill("Guest");
  await cart
    .getByLabel("Email address", { exact: true })
    .fill("guest@example.com");
  await cart.getByRole("radio", { name: /Delivery/ }).check();
  await cart.getByLabel("Recipient name", { exact: true }).fill("Test Guest");
  await cart.getByLabel("Delivery phone", { exact: true }).fill("0821234567");
  await cart
    .getByLabel("Street address", { exact: true })
    .fill("12 Private Street");
  await cart.getByLabel("City or town", { exact: true }).fill("Pretoria");
  await cart.getByLabel("Postal code", { exact: true }).fill("0001");
  await cart.getByLabel("Province", { exact: true }).selectOption("Gauteng");
  await expect(cart.locator(".checkout-summary")).toContainText(/R\s?288/);
  await cart
    .getByRole("button", { name: "CONTINUE TO PAYFAST TEST", exact: true })
    .click();
  await expect(cart.getByText("Checkout saved", { exact: true })).toBeVisible();
  const link = await cart.getByLabel("Private tracking link").inputValue();
  const token = link.split("#track=")[1];
  await page.goto(link);
  const result = page.locator(".tracking-result");
  await expect(result).toContainText("Awaiting payment verification");
  await expect(result).toContainText(/Delivery fee: R\s?99/);
  await expect(result).not.toContainText("12 Private Street");
  await expect(result).not.toContainText("guest@example.com");
  expect(page.url()).not.toContain(token);
  expect(page.url()).toContain("#tracking");
  await result.getByRole("button", { name: "Check for updates" }).click();
  await expect(result).toContainText("Payment is unverified");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("an expired or invalid link shows no stale status or customer details", async ({
  page,
}) => {
  await page.route("**/api/tracking/view", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ message: "invalid" }),
    }),
  );
  await page.goto(`/#track=${"x".repeat(43)}`);
  await expect(page.locator("#tracking [role=alert]")).toContainText(
    "invalid or has expired",
  );
  await expect(page.locator(".tracking-result")).toHaveCount(0);
  expect(page.url()).toContain("#tracking");
});
