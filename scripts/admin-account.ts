// First admin account and emergency password reset for the web sign-in.
//
//   node scripts/admin-account.ts            Creates the first admin from SAJADA_ADMIN_USERNAME
//                                            (default "admin") and SAJADA_ADMIN_PASSWORD when no
//                                            active admin exists; otherwise does nothing.
//                                            Runs at every container start (docker/app-entrypoint.sh).
//   node scripts/admin-account.ts reset NAME  Gives account NAME a new temporary password (printed),
//                                            unlocks and re-activates it.
//
// Either way the password must be replaced at the next sign-in.
import { randomBytes } from "node:crypto";
import { pool } from "../lib/server/db.ts";
import { hashPassword } from "../lib/server/password.ts";

const db = pool();
const [command, target] = process.argv.slice(2);

async function audit(action: string, userId: string, detail: object) {
  await db.query("INSERT INTO sajada.app_user_audit(action,user_id,detail) VALUES($1,$2,$3)", [action, userId, JSON.stringify(detail)]);
}

try {
  if (command === "reset") {
    const username = String(target ?? "").toLowerCase();
    const password = randomBytes(9).toString("base64url");
    const row = (
      await db.query(
        "UPDATE sajada.app_user SET password_hash=$2,must_change_password=true,active=true,failed_logins=0,locked_until=NULL,updated_at=now() WHERE username=$1 RETURNING id",
        [username, await hashPassword(password)],
      )
    ).rows[0];
    if (!row) {
      console.error(`Akun "${username}" tidak ditemukan.`);
      process.exitCode = 1;
    } else {
      await db.query("DELETE FROM sajada.app_session WHERE user_id=$1", [row.id]);
      await audit("password_reset", row.id, { via: "admin-account.ts" });
      console.log(`Password sementara untuk ${username}: ${password}\nWajib diganti saat login berikutnya.`);
    }
  } else if (command) {
    console.error("Pemakaian: node scripts/admin-account.ts [reset USERNAME]");
    process.exitCode = 1;
  } else if ((await db.query("SELECT 1 FROM sajada.app_user WHERE role='admin' AND active")).rows[0]) {
    console.log("admin account: present");
  } else {
    const username = (process.env.SAJADA_ADMIN_USERNAME || "admin").toLowerCase();
    const password = process.env.SAJADA_ADMIN_PASSWORD || "";
    if (!password) {
      console.warn("admin account: belum ada admin. Isi SAJADA_ADMIN_PASSWORD (dan opsional SAJADA_ADMIN_USERNAME), lalu jalankan ulang aplikasi.");
    } else {
      const id = (
        await db.query(
          `INSERT INTO sajada.app_user(username,display_name,role,password_hash,must_change_password) VALUES($1,'Admin koperasi','admin',$2,true)
           ON CONFLICT (username) DO UPDATE SET role='admin',active=true,password_hash=EXCLUDED.password_hash,must_change_password=true,
             tenant_id=NULL,member_id=NULL,investor_id=NULL,failed_logins=0,locked_until=NULL,updated_at=now()
           RETURNING id`,
          [username, await hashPassword(password)],
        )
      ).rows[0].id;
      await audit("create", id, { username, role: "admin", via: "SAJADA_ADMIN_PASSWORD" });
      console.log(`admin account: "${username}" dibuat; password dari SAJADA_ADMIN_PASSWORD wajib diganti saat login pertama.`);
    }
  }
} finally {
  await db.end();
}
