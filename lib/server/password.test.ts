import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, passwordProblem, verifyPassword } from "./password.ts";

test("hash verifies only the same password and is salted", async () => {
  const a = await hashPassword("rahasia-123"), b = await hashPassword("rahasia-123");
  assert.match(a, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("rahasia-123", a), true);
  assert.equal(await verifyPassword("rahasia-124", a), false);
  assert.equal(await verifyPassword("rahasia-123", "bukan-hash"), false);
});

test("password rules", async () => {
  assert.match(passwordProblem("pendek") ?? "", /minimal 8/);
  assert.equal(passwordProblem("cukup-panjang"), null);
  await assert.rejects(hashPassword("1234567"), /minimal 8/);
});
