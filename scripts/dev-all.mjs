// Local dev: start PostgreSQL (Docker), then the Next.js app (web + /v1 API) on port 5173.
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const services = fileURLToPath(new URL("../services", import.meta.url));

const db = spawnSync("docker", ["compose", "up", "-d", "postgres"], { cwd: services, stdio: "inherit" });
if (db.status !== 0) process.exit(db.status ?? 1);

const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", "5173"], { cwd: root, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => next.kill(signal));
next.on("exit", (code) => process.exit(code ?? 0));
