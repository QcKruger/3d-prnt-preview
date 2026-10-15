import { expect, test } from "@playwright/test";

test("printer status advances, stays in sync with the graphic, and loops", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.goto("/");
  const progress = page.getByRole("progressbar", {
    name: "Illustrative print progress",
  });
  await expect(page.locator(".printer-status small")).toHaveText(
    "Layer 142 of 187 · Printer animation",
  );
  await expect(progress).toHaveAttribute("aria-valuenow", "76");
  await page.clock.runFor(1600);
  await expect(page.locator(".printer-status small")).toHaveText(
    "Layer 152 of 187 · Printer animation",
  );
  await expect(progress).toHaveAttribute("aria-valuenow", "81");
  const state = await page.locator(".machine").evaluate((element) => ({
    progress: element.style.getPropertyValue("--print-progress"),
    headAnimation: getComputedStyle(element.querySelector(".head")!)
      .animationName,
  }));
  expect(Number(state.progress)).toBeCloseTo(152 / 187);
  expect(state.headAnimation).toBe("printer-sweep");
  await page.clock.runFor(35 * 160);
  await expect(page.locator(".printer-status-heading strong")).toHaveText(
    "Print complete",
  );
  await expect(progress).toHaveAttribute("aria-valuenow", "100");
  await page.clock.runFor(160);
  await expect(page.locator(".printer-status small")).toHaveText(
    "Layer 1 of 187 · Printer animation",
  );
});

test("printer respects reduced motion and resumes when the preference changes", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.goto("/");
  await page.clock.runFor(1600);
  await expect(page.locator(".printer-status small")).toHaveText(
    "Layer 142 of 187 · Reduced motion",
  );
  expect(
    await page
      .locator(".head")
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator(".printer-status-heading strong")).toHaveText(
    "Print in progress",
  );
  await page.clock.runFor(1600);
  await expect(page.locator(".printer-status small")).toHaveText(
    "Layer 152 of 187 · Printer animation",
  );
});
