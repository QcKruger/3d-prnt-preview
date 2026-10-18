import { expect, test } from "@playwright/test";

test("checkout posts the signed server-priced form to PayFast sandbox", async ({
  page,
}) => {
  let submitted: URLSearchParams | undefined;
  await page.route(
    "https://sandbox.payfast.co.za/eng/process",
    async (route) => {
      submitted = new URLSearchParams(route.request().postData() || "");
      await route.fulfill({
        contentType: "text/html",
        body: "<h1>Sandbox handoff captured</h1>",
      });
    },
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Add Geometric Planter to cart", exact: true })
    .click();
  const cart = page.getByRole("dialog", { name: /Your cart/ });
  await cart.getByRole("button", { name: /REVIEW CHECKOUT/ }).click();
  await cart.getByLabel("First name", { exact: true }).fill("Test");
  await cart.getByLabel("Surname", { exact: true }).fill("Buyer");
  await cart
    .getByLabel("Email address", { exact: true })
    .fill("sandbox-test@example.com");
  await cart
    .getByRole("button", { name: "CONTINUE TO PAYFAST TEST", exact: true })
    .click();
  await expect(cart.getByText("Checkout saved", { exact: true })).toBeVisible();
  await expect(cart.getByLabel("Private tracking link")).toHaveValue(/#track=/);
  await cart
    .getByRole("button", { name: "OPEN PAYFAST TEST ↗", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sandbox handoff captured" }),
  ).toBeVisible();
  expect(submitted?.get("amount")).toBe("189.00");
  expect(submitted?.get("merchant_id")).toBe("10004002");
  expect(submitted?.get("signature")).toMatch(/^[\da-f]{32}$/);
  expect(submitted?.get("return_url")).toBe(
    "https://3dprntweb-e2hwa9g0hdc8g3fj.westus3-01.azurewebsites.net/?payment=return",
  );
  expect(submitted?.get("cancel_url")).toBe(
    "https://3dprntweb-e2hwa9g0hdc8g3fj.westus3-01.azurewebsites.net/?payment=cancel",
  );
  expect(submitted?.get("notify_url")).toBe(
    "https://3dprntweb-e2hwa9g0hdc8g3fj.westus3-01.azurewebsites.net/api/payment/notify",
  );
  expect(submitted?.has("passphrase")).toBe(false);
});

test("return parameters never claim a verified payment", async ({ page }) => {
  await page.goto("/?payment=success");
  await expect(
    page.getByRole("status").filter({ hasText: "No real payment or order" }),
  ).toContainText("does not confirm a payment");
  await expect(
    page.getByText("Payment confirmed", { exact: true }),
  ).toHaveCount(0);
});
