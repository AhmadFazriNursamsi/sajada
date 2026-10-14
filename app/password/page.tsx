import Link from "next/link";
import { redirect } from "next/navigation";
import { PasswordForm } from "@/components/AuthForms";
import { currentUser } from "@/lib/server/auth";
import { isStaff } from "@/lib/roles";
import { logoutAction } from "../actions/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ganti password · Sajada" };

export default async function PasswordPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <div className="authpage">
      <div className="authcard">
        <h1>{user.mustChangePassword ? "Buat password baru" : "Ganti password"}</h1>
        <p className="muted">
          {user.mustChangePassword
            ? `Halo ${user.name}, akun Anda memakai password sementara. Ganti dulu sebelum melanjutkan.`
            : `Akun ${user.username}.`}
        </p>
        <PasswordForm forced={user.mustChangePassword} />
        {user.mustChangePassword ? (
          <form action={logoutAction} className="authback"><button className="textbutton">Keluar</button></form>
        ) : (
          <p className="authback"><Link href={isStaff(user.role) ? "/" : "/portal"}>Kembali</Link></p>
        )}
      </div>
    </div>
  );
}
