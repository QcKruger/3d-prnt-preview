import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("guest can log a damaged return, keep its reference and start a new request", async ({
  page,
}) => {
  await page.goto("/#returns");
  const form = page.locator("#returns form");
  await expect(form.locator("#return-fee-notice")).toContainText(
    "10% handling fee",
  );
  await form.getByRole("button", { name: "LOG RETURN REQUEST" }).click();
  await expect(form.getByLabel("Your name")).toBeFocused();
  await form.getByLabel("Your name").fill("Test Guest");
  await form.getByLabel("Email address").fill("guest@example.com");
  await form.getByLabel("Order or payment reference").fill("3D-test-reference");
  await form.getByLabel("Item name or description").fill("Geometric planter");
  await form.getByLabel("Reason for return").selectOption("damaged");
  await form
    .getByLabel("What happened?")
    .fill("The planter arrived with a broken corner and a crack in the base.");
  await form.getByLabel("Preferred outcome").selectOption("replacement");
  await form.getByRole("checkbox").check();
  await form.getByRole("button", { name: "LOG RETURN REQUEST" }).click();
  const confirmation = page.locator(".return-confirmation");
  await expect(confirmation).toContainText("LOCAL TEST RECEIVED");
  await expect(confirmation).toContainText("Pending review");
  await expect(confirmation).toContainText("10% handling fee");
  const trackingLink = await confirmation
    .getByLabel("Private tracking link")
    .inputValue();
  await expect(confirmation.locator(".return-reference")).toHaveText(
    /^RMA-[a-f0-9-]{36}$/,
  );
  const download = page.waitForEvent("download");
  await confirmation
    .getByRole("button", { name: "SAVE RETURN REFERENCE" })
    .click();
  const receiptDownload = await download;
  expect(receiptDownload.suggestedFilename()).toBe(
    "3d-prnt-return-reference.txt",
  );
  expect(await readFile((await receiptDownload.path())!, "utf8")).toContain(
    "Handling fee: 10% of any approved refund amount",
  );
  await confirmation
    .getByRole("button", { name: "Log another return" })
    .click();
  await expect(form.getByLabel("Email address")).toHaveValue("");
  await page.goto(trackingLink);
  await expect(page.locator(".tracking-result")).toContainText(
    "Pending review",
  );
  await expect(page.locator(".tracking-result")).toContainText(
    "handling fee is 10%",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("a failed save preserves details and retrying uses the same request identifier", async ({
  page,
}) => {
  const submissions: { requestId: string }[] = [];
  await page.route("**/api/returns", async (route) => {
    const body = route.request().postDataJSON();
    submissions.push(body);
    await route.fulfill({
      status: submissions.length === 1 ? 503 : 201,
      contentType: "application/json",
      body: JSON.stringify(
        submissions.length === 1
          ? { message: "unavailable" }
          : {
              reference: `RMA-${body.requestId}`,
              status: "pending-review",
              localDevelopment: false,
            },
      ),
    });
  });
  await page.goto("/#returns");
  const form = page.locator("#returns form");
  await form.getByLabel("Your name").fill("Test Guest");
  await form.getByLabel("Email address").fill("guest@example.com");
  await form.getByLabel("Order or payment reference").fill("3D-test-reference");
  await form.getByLabel("Item name or description").fill("Controller stand");
  await form.getByLabel("Reason for return").selectOption("other");
  await form
    .getByLabel("What happened?")
    .fill(
      "Please help me review a return for this item because it does not fit my setup.",
    );
  await form.getByRole("checkbox").check();
  await form.getByRole("button", { name: "LOG RETURN REQUEST" }).click();
  await expect(form.getByRole("alert")).toContainText("could not confirm");
  await expect(form.getByLabel("Email address")).toHaveValue(
    "guest@example.com",
  );
  await expect(page.locator(".return-confirmation")).toHaveCount(0);
  await form.getByRole("button", { name: "LOG RETURN REQUEST" }).click();
  await expect(page.locator(".return-confirmation")).toContainText(
    "Your return request is logged.",
  );
  expect(submissions).toHaveLength(2);
  expect(submissions[0].requestId).toBe(submissions[1].requestId);
});
