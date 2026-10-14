import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { currentUser } from "@/lib/server/auth";
import { investorPortal, memberPortal, type InvestorPortal, type MemberPortal } from "@/lib/server/portal";
import { userMessage } from "@/lib/server/workspace";
import { isStaff, ROLE_LABELS } from "@/lib/roles";
import { formatMoney } from "@/shared/money";
import { logoutAction } from "../actions/auth";

// Self-service portal: a member or investor sees only their own data (lib/server/portal.ts).
export const dynamic = "force-dynamic";
export const metadata = { title: "Portal · Sajada" };

const rp = (n: number) => formatMoney(n, "IDR");
const STATUS: Record<string, string> = { pending: "Menunggu", approved: "Disetujui", paid: "Dibayar (dicatat)", settled: "Selesai" };

export default async function PortalPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/password");
  if (isStaff(user.role)) redirect("/");
  let data: MemberPortal | InvestorPortal | null = null, error = "";
  try {
    data = user.role === "member" ? await memberPortal(user) : await investorPortal(user);
  } catch (e) {
    error = userMessage(e);
  }
  return (
    <div className="portal">
      <header className="portalhead">
        <Image src="/brand/sajada-horizontal.png" alt="Sajada" width={1246} height={383} className="portallogo" priority />
        <div className="portaluser">
          <div><strong>{user.name}</strong><small>{ROLE_LABELS[user.role]} · {user.tenants[0]}</small></div>
          <Link href="/password" className="secondary">Ganti password</Link>
          <form action={logoutAction}><button className="secondary" aria-label="Keluar"><LogOut size={16} />Keluar</button></form>
        </div>
      </header>
      <main className="portalbody">
        <p className="muted portalnote">Status pembayaran dan bagi hasil adalah pencatatan koperasi, bukan konfirmasi bank.</p>
        {error && <p className="formerror" role="alert">{error}</p>}
        {data?.kind === "member" && <Member d={data} />}
        {data?.kind === "investor" && <Investor d={data} />}
      </main>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="stat"><div className="statlabel">{label}</div><div className="statvalue">{value}</div>{note && <small className="muted">{note}</small>}</div>;
}

function Member({ d }: { d: MemberPortal }) {
  const sum = (status: string) => d.commissions.filter((c) => c.status === status).reduce((s, c) => s + c.amount, 0);
  const settled = d.sharing.filter((r) => r.status === "settled");
  return (
    <>
      <h1>Halo, {d.name}</h1>
      <p className="muted">{d.number ? `No. anggota ${d.number}` : "Nomor anggota belum diterbitkan"} · {d.area || "Daerah belum diisi"} · Level {d.level || "—"}{d.sponsor ? ` · Sponsor ${d.sponsor}` : ""}</p>
      <div className="stats">
        <Stat label="Saldo belanja" value={d.wallet.activated ? rp(d.wallet.balance) : "Belum aktif"} note={d.wallet.activated ? `Saldo awal ${rp(d.wallet.opening)}` : "Diaktifkan oleh petugas koperasi"} />
        <Stat label="Komisi disetujui" value={rp(sum("approved"))} note={`Menunggu ${rp(sum("pending"))}`} />
        <Stat label="Komisi dibayar" value={rp(sum("paid"))} note="Pencatatan koperasi, bukan transfer bank" />
        <Stat label="Sisa penyertaan" value={d.wallet.activated || d.sharing.length ? rp(d.remainingPrincipal) : "Belum aktif"} note={d.wallet.activated || d.sharing.length ? `Dari ${settled.length} laporan bagi hasil selesai` : "Penyertaan Rp12,5 juta belum diaktifkan"} />
      </div>
      <section className="panel">
        <div className="panelhead"><h2>Pesanan saya</h2></div>
        {d.orders.length ? (
          <table><thead><tr><th>PESANAN</th><th>TANGGAL</th><th>PERAN</th><th>NILAI</th><th>STATUS</th></tr></thead>
            <tbody>{d.orders.map((o) => <tr key={o.id}><td>{o.id}</td><td>{o.date ?? "—"}</td><td>{o.as}</td><td>{rp(o.total)}</td><td>{o.status}</td></tr>)}</tbody></table>
        ) : <p className="empty">Belum ada pesanan.</p>}
      </section>
      <section className="panel">
        <div className="panelhead"><h2>Komisi saya</h2><p>Dari pesanan lunas yang sudah diterima pelanggan.</p></div>
        {d.commissions.length ? (
          <table><thead><tr><th>PESANAN</th><th>TINGKAT</th><th>TARIF</th><th>KOMISI</th><th>STATUS</th></tr></thead>
            <tbody>{d.commissions.map((c) => <tr key={c.orderId + c.level}><td>{c.orderId}</td><td>{c.level === 0 ? "Penjual" : `Upline ${c.level}`}</td><td>{c.rate}%</td><td>{rp(c.amount)}</td><td>{STATUS[c.status] ?? c.status}</td></tr>)}</tbody></table>
        ) : <p className="empty">Belum ada komisi.</p>}
        {d.corrections.length > 0 && <p className="empty">Koreksi retur: {d.corrections.map((c) => `${c.orderId} (${rp(c.amount)}, ${c.reference})`).join("; ")}</p>}
      </section>
      <section className="panel">
        <div className="panelhead"><h2>Bagi hasil penyertaan</h2><p>Bagian keuntungan Anda per laporan.</p></div>
        {d.sharing.length ? (
          <table><thead><tr><th>PERIODE</th><th>REFERENSI</th><th>LABA</th><th>BAGIAN ANDA</th><th>PENGEMBALIAN MODAL</th><th>STATUS</th></tr></thead>
            <tbody>{d.sharing.map((r) => <tr key={r.id}><td>{r.period}</td><td>{r.reference}</td><td>{rp(r.profit)}</td><td>{rp(r.memberShare)}</td><td>{rp(r.capitalReturned)}</td><td>{STATUS[r.status] ?? "Draf"}</td></tr>)}</tbody></table>
        ) : <p className="empty">Belum ada laporan bagi hasil.</p>}
      </section>
    </>
  );
}

function Investor({ d }: { d: InvestorPortal }) {
  const funded = d.allocations.reduce((s, a) => s + a.amount, 0);
  const returned = d.receipts.reduce((s, r) => s + r.capitalReturned, 0);
  const profit = d.receipts.reduce((s, r) => s + r.profitShare, 0);
  return (
    <>
      <h1>Halo, {d.name}</h1>
      <p className="muted">Kode investor {d.code}</p>
      <div className="stats">
        <Stat label="Total penyertaan" value={rp(funded)} note={`${d.allocations.length} anggota didanai`} />
        <Stat label="Modal kembali" value={rp(returned)} />
        <Stat label="Sisa modal" value={rp(Math.max(funded - returned, 0))} />
        <Stat label="Bagi hasil diterima" value={rp(profit)} note="Dari laporan berstatus selesai" />
      </div>
      <section className="panel">
        <div className="panelhead"><h2>Alokasi penyertaan</h2></div>
        {d.allocations.length ? (
          <table><thead><tr><th>ANGGOTA</th><th>NOMINAL</th></tr></thead>
            <tbody>{d.allocations.map((a) => <tr key={a.member}><td>{a.member}</td><td>{rp(a.amount)}</td></tr>)}</tbody></table>
        ) : <p className="empty">Belum ada alokasi penyertaan.</p>}
      </section>
      <section className="panel">
        <div className="panelhead"><h2>Penerimaan per laporan</h2><p>Hanya laporan bagi hasil yang sudah selesai.</p></div>
        {d.receiptError && <p className="formerror">{d.receiptError}</p>}
        {d.receipts.length ? (
          <table><thead><tr><th>PERIODE</th><th>ANGGOTA</th><th>MODAL KEMBALI</th><th>BAGI HASIL</th><th>TOTAL</th></tr></thead>
            <tbody>{d.receipts.map((r, i) => <tr key={i}><td>{r.period}</td><td>{r.member}</td><td>{rp(r.capitalReturned)}</td><td>{rp(r.profitShare)}</td><td>{rp(r.total)}</td></tr>)}</tbody></table>
        ) : <p className="empty">Belum ada penerimaan.</p>}
      </section>
    </>
  );
}
