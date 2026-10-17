import { expect, test } from "@playwright/test";

test("each HTML response has a fresh nonce and injected inline scripts/styles are blocked", async ({
  page,
  request,
}) => {
  // Inject into the HTML parser, not via DevTools evaluation (which has elevated privileges).
  await page.route("http://127.0.0.1:4173/", async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    await route.fulfill({
      response,
      body: html.replace(
        "</body>",
        '<script>window.__untrustedScriptRan=true</script><div id="untrusted-style" style="position:fixed"></div></body>',
      ),
    });
  });
  const response = await page.goto("/");
  const policy = response!.headers()["content-security-policy"];
  const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  expect(policy).not.toContain("unsafe-inline");
  expect(
    await page
      .locator("script[src]")
      .first()
      .evaluate((element) => (element as HTMLScriptElement).nonce),
  ).toBe(nonce);
  const second = await request.get("/");
  expect(second.headers()["content-security-policy"]).not.toBe(policy);
  const result = await page.evaluate(() => {
    const node = document.getElementById("untrusted-style")!;
    return {
      scriptRan: Boolean(
        (window as Window & { __untrustedScriptRan?: boolean })
          .__untrustedScriptRan,
      ),
      position: getComputedStyle(node).position,
    };
  });
  expect(result.scriptRan).toBe(false);
  expect(result.position).not.toBe("fixed");
});
