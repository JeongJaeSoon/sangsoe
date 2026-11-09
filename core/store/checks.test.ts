import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { checkLocalFs, checkSqliteVersion, defaultFsProbe, NETWORK_FS, sqliteVersionOk } from "./checks.ts";

test("SQLite floor: 3.51.3+, or 3.50.7+ / 3.44.6+ backports (decision 35, B3)", () => {
  for (const v of ["3.51.3", "3.52.0", "3.54.0", "3.50.7", "3.50.9", "3.44.6", "3.44.10", "4.0.0"]) {
    assert.ok(sqliteVersionOk(v), v);
  }
  for (const v of ["3.51.2", "3.50.6", "3.50.0", "3.49.9", "3.45.0", "3.44.5", "3.7.0", "2.9.9", "garbage"]) {
    assert.ok(!sqliteVersionOk(v), v);
  }
  const bad = checkSqliteVersion("3.50.0");
  assert.equal(bad.ok, false);
  assert.match(bad.fix ?? "", /Node >= 24\.15/);
  assert.equal(checkSqliteVersion("3.51.3").fix, undefined);
});

test("the runtime's own SQLite passes the floor", () => {
  assert.ok(sqliteVersionOk(process.versions.sqlite ?? ""), `node ${process.version} bundles ${process.versions.sqlite}`);
});

test("a network filesystem, an unknown one, or a failing probe refuses the location (B3)", () => {
  for (const fs of NETWORK_FS) assert.equal(checkLocalFs("/db", () => fs).ok, false, fs);
  assert.equal(checkLocalFs("/db", () => "unknown").ok, false);
  const thrown = checkLocalFs("/db", () => {
    throw new Error("no mount table");
  });
  assert.equal(thrown.ok, false);
  assert.match(thrown.detail, /no mount table/);
  for (const fs of ["apfs", "ext4", "local:0xef53", "tmpfs"]) assert.equal(checkLocalFs("/db", () => fs).ok, true, fs);
});

test("the default probe names this machine's temp volume as local", () => {
  const type = defaultFsProbe(`${tmpdir()}/does/not/exist/yet`);
  assert.equal(typeof type, "string");
  assert.ok(checkLocalFs(tmpdir()).ok, `temp dir reported as ${type}`);
});
