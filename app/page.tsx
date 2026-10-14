import { redirect } from "next/navigation";
import Workspace from "@/components/Workspace";
import { currentUser } from "@/lib/server/auth";
import { isStaff } from "@/lib/roles";
import { logoutAction } from "./actions/auth";

// Staff workspace. Signed-out visitors go to /login, member/investor accounts to their portal.
export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/password");
  if (!isStaff(user.role)) redirect("/portal");
  if (!user.tenants.length)
    return (
      <div className="authpage">
        <div className="authcard">
          <h1>Belum ada akses koperasi</h1>
          <p>Akun {user.username} belum diberi akses ke koperasi mana pun. Minta admin koperasi menambahkan akses di Pengaturan → Pengguna &amp; akses.</p>
          <form action={logoutAction}><button className="primary full">Keluar</button></form>
        </div>
      </div>
    );
  return <Workspace user={user} />;
}
