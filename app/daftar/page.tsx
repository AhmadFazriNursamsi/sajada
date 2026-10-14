import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import RegisterForm from "@/components/RegisterForm";
import { currentUser } from "@/lib/server/auth";

// Public sign-up for prospective members; a member officer approves each request.
export const dynamic = "force-dynamic";
export const metadata = { title: "Daftar anggota · Sajada" };

export default async function RegisterPage() {
  if (await currentUser()) redirect("/");
  return (
    <div className="authpage">
      <div className="authcard registercard">
        <Image src="/brand/sajada-vertical.png" alt="Sajada" width={1246} height={1263} className="authlogo" priority />
        <h1>Daftar sebagai anggota</h1>
        <p className="muted">Isi data Anda. Akun dapat dipakai setelah disetujui petugas koperasi.</p>
        <RegisterForm />
        <p className="authback">Sudah punya akun? <Link href="/login">Masuk</Link></p>
      </div>
    </div>
  );
}
