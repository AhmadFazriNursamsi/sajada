import test from "node:test";
import assert from "node:assert/strict";
import { allowedHost, validBasicAuth } from "./web-access.ts";

const basic = (value: string) => `Basic ${Buffer.from(value).toString("base64")}`;
const withEnv = (env: Record<string, string>, fn: () => void) => {
  const keys = ["SAJADA_WEB_USER", "SAJADA_WEB_PASSWORD", "SAJADA_PUBLIC_HOSTS", "SAJADA_OPEN_ACCESS"];
  const saved = keys.map((k) => process.env[k]);
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  try { fn(); } finally { keys.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i]))); }
};

test("without a password only loopback hosts are allowed, even if public hosts are listed", () =>
  withEnv({ SAJADA_PUBLIC_HOSTS: "sajada.devoutsys.com" }, () => {
    assert.equal(allowedHost("127.0.0.1:3000"), true);
    assert.equal(allowedHost("localhost"), true);
    assert.equal(allowedHost("sajada.devoutsys.com"), false);
    assert.equal(validBasicAuth(basic("admin:")), false);
  }));

test("with a password the listed public hosts are allowed, others are not", () =>
  withEnv({ SAJADA_WEB_PASSWORD: "s3cret", SAJADA_PUBLIC_HOSTS: " Sajada.devoutsys.com ,other.example" }, () => {
    assert.equal(allowedHost("sajada.devoutsys.com"), true);
    assert.equal(allowedHost("SAJADA.devoutsys.com:443"), true);
    assert.equal(allowedHost("evil.example"), false);
    assert.equal(allowedHost("202.59.166.142"), false);
  }));

test("basic auth needs the configured user (default admin) and password", () =>
  withEnv({ SAJADA_WEB_PASSWORD: "s3cret" }, () => {
    assert.equal(validBasicAuth(basic("admin:s3cret")), true);
    assert.equal(validBasicAuth(basic("admin:wrong")), false);
    assert.equal(validBasicAuth(basic("root:s3cret")), false);
    assert.equal(validBasicAuth(null), false);
    assert.equal(validBasicAuth("Bearer abc"), false);
  }));

test("a custom user name is honoured", () =>
  withEnv({ SAJADA_WEB_USER: "pengurus", SAJADA_WEB_PASSWORD: "s3cret" }, () => {
    assert.equal(validBasicAuth(basic("pengurus:s3cret")), true);
    assert.equal(validBasicAuth(basic("admin:s3cret")), false);
  }));

test("open access allows the listed public hosts without a password, and only those", () =>
  withEnv({ SAJADA_OPEN_ACCESS: "1", SAJADA_PUBLIC_HOSTS: "sajada.devoutsys.com" }, () => {
    assert.equal(allowedHost("sajada.devoutsys.com"), true);
    assert.equal(allowedHost("evil.example"), false);
    assert.equal(allowedHost("127.0.0.1:3000"), true);
  }));

test("open access needs exactly 1", () =>
  withEnv({ SAJADA_OPEN_ACCESS: "true", SAJADA_PUBLIC_HOSTS: "sajada.devoutsys.com" }, () => {
    assert.equal(allowedHost("sajada.devoutsys.com"), false);
  }));
