import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/AuthForms";
import { currentUser } from "@/lib/server/auth";
import { isStaff } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Masuk · Sajada" };

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect(user.mustChangePassword ? "/password" : isStaff(user.role) ? "/" : "/portal");
  return (
    <div className="authpage">
      <div className="authcard">
        <Image src="/brand/sajada-vertical.png" alt="Sajada" width={1246} height={1263} className="authlogo" priority />
        <h1>Masuk ke Sajada</h1>
        <p className="muted">Gunakan akun yang diberikan admin koperasi.</p>
        <LoginForm />
        <p className="authback">Calon anggota? <Link href="/daftar">Daftar di sini</Link></p>
      </div>
    </div>
  );
}
