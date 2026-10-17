import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function secretFindings(filename: string, text: string): string[] {
  const findings: string[] = [];
  if (
    /(?:^|\/)\.env(?:\..+)?$/.test(filename) &&
    !filename.endsWith(".env.example")
  )
    findings.push("environment file must not be committed");
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))
    findings.push("private key");
  if (
    /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16})\b/.test(
      text,
    )
  )
    findings.push("access token");
  const assignments =
    /PAYFAST_(?:SANDBOX_)?(?:MERCHANT_KEY|PASSPHRASE)[ \t]*[:=][ \t]*["']?([^\s,'"#;)\r\n}]+)/g;
  for (const match of text.matchAll(assignments)) {
    const value = match[1];
    if (
      value.length < 8 ||
      /^(?:YOUR_|TEST_|REPLACE_|<|env\.|process\.)/.test(value)
    )
      continue;
    findings.push(
      "literal PayFast credential; use server environment settings",
    );
    break;
  }
  return findings;
}

export function checkSecrets(staged = false) {
  const args = staged
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]
    : ["ls-files", "--cached", "--others", "--exclude-standard", "-z"];
  const filenames = [
    ...new Set(
      execFileSync("git", args, { encoding: "utf8" })
        .split("\0")
        .filter(Boolean),
    ),
  ];
  let failures = 0;
  for (const filename of filenames) {
    const fileFindings = secretFindings(filename, "");
    if (fileFindings.length) {
      for (const finding of fileFindings)
        console.error(`${filename}: ${finding}`);
      failures += fileFindings.length;
      continue;
    }
    let contents: Buffer;
    try {
      contents = staged
        ? execFileSync("git", ["show", ":" + filename], {
            maxBuffer: 10 * 1024 * 1024,
          })
        : readFileSync(filename);
    } catch (error) {
      if (!staged && (error as NodeJS.ErrnoException).code === "ENOENT")
        continue;
      console.error(`${filename}: could not scan file`);
      failures++;
      continue;
    }
    if (contents.subarray(0, 8192).includes(0)) continue;
    for (const finding of secretFindings(filename, contents.toString("utf8"))) {
      // Report only filename/rule; never print the matched secret.
      console.error(`${filename}: ${finding}`);
      failures++;
    }
  }
  return failures;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const failures = checkSecrets(process.argv.includes("--staged"));
  if (failures) process.exitCode = 1;
  else console.log("Secret guard passed.");
}
