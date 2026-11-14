import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Headless Chrome for the panel's layout tests (U116): the page is drawn as Orca draws an html panel,
// and the page itself writes what it measured into <pre id="out">, which --dump-dom returns.

export function chrome(): string | null {
  const named = process.env.CHROME;
  if (named) return named;
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (process.platform === "darwin" && existsSync(mac)) return mac;
  for (const bin of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const r = spawnSync("which", [bin], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}

/** A test that needs a browser runs wherever one is found, and always on CI. */
export const noBrowser = !chrome() && !process.env.CI ? "no Chrome on this machine (CI requires one)" : false;

/** Loads `dir/index.html` and returns the JSON its page put in <pre id="out">. */
export function dump(dir: string, index: string, budgetMs = 5000): unknown {
  const bin = chrome();
  assert.ok(bin, "no Chrome: set CHROME");
  writeFileSync(join(dir, "index.html"), index);
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--allow-file-access-from-files",
    `--user-data-dir=${join(dir, "profile")}`,
    "--window-size=1000,1200",
    `--virtual-time-budget=${budgetMs}`,
    ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    "--dump-dom",
    `file://${join(dir, "index.html")}`,
  ];
  const r = spawnSync(bin, args, { encoding: "utf8", timeout: 60_000 });
  const json = /<pre id="out">([^<]*)<\/pre>/.exec(r.stdout)?.[1];
  assert.ok(json, `no measurement from Chrome: ${r.stderr.slice(-500)}`);
  return JSON.parse(json.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"));
}

/** Orca's html panel page for a .ts entry (the frame bridge aside): no body tag, #root alone. */
export const orcaPage = (head: string, body: string): string =>
  `<!doctype html>\n<html class="light">\n<head>\n<meta charset="utf-8">\n<style id="tokens">:root{}</style>\n${head}</head>\n<div id="root"></div>\n${body}`;
