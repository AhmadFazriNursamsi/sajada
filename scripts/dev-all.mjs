// Local dev: start PostgreSQL (Docker), the transaction API and the web on one public port.
// The web dev server proxies /v1 and /healthz to the API (see vite.config.ts).
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const services = fileURLToPath(new URL("../services", import.meta.url));

const db = spawnSync("docker", ["compose", "up", "-d", "postgres"], { cwd: services, stdio: "inherit" });
if (db.status !== 0) process.exit(db.status ?? 1);

const children = [
  spawn("bash", ["start-api.sh"], { cwd: services, stdio: "inherit" }),
  spawn(process.execPath, ["scripts/run-framework.mjs", "dev"], { cwd: root, stdio: "inherit" }),
];

const stop = () => { for (const c of children) c.kill("SIGTERM"); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const c of children) c.on("exit", (code) => { stop(); process.exitCode ||= code ?? 0; });
