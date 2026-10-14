// One-time local setup: PostgreSQL in Docker, the app's database role, .env.local and demo data.
// Usage: pnpm db:setup   (safe to run again; existing passwords and data are kept)
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const services = fileURLToPath(new URL("../services", import.meta.url));
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: ["pipe", "inherit", "inherit"], ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
const readEnv = (file) => (existsSync(file) ? Object.fromEntries(readFileSync(file, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])) : {});
const secret = () => randomBytes(16).toString("hex");

// 1. Passwords for Docker Compose (services/.env, git-ignored).
const composeFile = `${services}/.env`, compose = readEnv(composeFile);
const missing = ["POSTGRES_PASSWORD", "CLICKHOUSE_PASSWORD", "SAJADA_API_PASSWORD", "SAJADA_ADMIN_PASSWORD"].filter((k) => !compose[k]);
if (missing.length) writeFileSync(composeFile, (existsSync(composeFile) ? readFileSync(composeFile, "utf8").replace(/\n?$/, "\n") : "") + missing.map((k) => `${k}=${secret()}`).join("\n") + "\n", { mode: 0o600 });
const env = readEnv(composeFile);

// 2. PostgreSQL (initialises every migration on a new volume).
run("docker", ["compose", "up", "-d", "--wait", "postgres"], { cwd: services });

// 3. Application role and grants.
run("docker", ["compose", "exec", "-T", "postgres", "psql", "-U", "sajada_owner", "-d", "sajada", "-v", "ON_ERROR_STOP=1", "-q", "-v", `pw=${env.SAJADA_API_PASSWORD}`],
  { cwd: services, input: Buffer.concat([readFileSync(`${services}/transaction/web-auth.sql`), readFileSync(`${services}/local-dev-role.sql`)]) });

// 4. .env.local for Next.js (git-ignored); keeps values already set.
const port = spawnSync("docker", ["compose", "port", "postgres", "5432"], { cwd: services, encoding: "utf8" }).stdout.trim().split(":").pop() || "5432";
const localFile = `${root}/.env.local`, local = readEnv(localFile);
const wanted = {
  DATABASE_URL: `postgres://sajada_api:${env.SAJADA_API_PASSWORD}@127.0.0.1:${port}/sajada`,
  OIDC_ISSUER: "http://127.0.0.1:8085/realms/sajada",
  OIDC_JWKS_URL: "http://127.0.0.1:8085/realms/sajada/protocol/openid-connect/certs",
  OIDC_AUDIENCE: "sajada-api",
  SAJADA_ADMIN_USERNAME: "admin",
  SAJADA_ADMIN_PASSWORD: env.SAJADA_ADMIN_PASSWORD,
};
const add = Object.entries(wanted).filter(([k]) => !local[k]);
if (add.length) writeFileSync(localFile, (existsSync(localFile) ? readFileSync(localFile, "utf8").replace(/\n?$/, "\n") : "# Local development only. Not committed (.gitignore: .env*).\n") + add.map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });

// 5. Demo koperasi data.
run(process.execPath, ["--env-file=.env.local", "scripts/seed-demo.ts"], { cwd: root });

// 6. First admin account (password in services/.env; must be replaced at the first sign-in).
run(process.execPath, ["--env-file=.env.local", "scripts/admin-account.ts"], { cwd: root });
console.log(`\nSiap. Jalankan: pnpm dev:all  →  http://127.0.0.1:5173\nLogin pertama: admin / ${env.SAJADA_ADMIN_PASSWORD} (wajib diganti; tersimpan di services/.env)`);
