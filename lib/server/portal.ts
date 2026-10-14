import { inTenant, pool, UserError } from "./db.ts";
import { loadWorkspace } from "./workspace/index.ts";
import { walletBalance, type CapitalRecord } from "../../shared/member-capital.ts";
import { commissions, POLICY, type Sale } from "../../shared/mlm.ts";
import { completedForCommission } from "../../shared/order-receipt.ts";
import { returnCorrections } from "../../shared/commission-return.ts";
import { investorReceipts, type Funding, type Investor } from "../../shared/funding.ts";
import { INITIAL_PRINCIPAL } from "../../shared/tiered-sharing.ts";
import type { SessionUser } from "../roles.ts";
import type { NumberState } from "../../shared/member-number.ts";

// Data for the member/investor portal. The whole koperasi workspace is read on the server and
// only the signed-in person's own rows are returned to the browser.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type OrderLine = { id: string; date?: string; total: number; status: string; as: "penjual" | "pembeli" | "penjual & pembeli" };
export type MemberPortal = {
  kind: "member";
  tenant: string;
  name: string;
  number: string | null;
  area: string;
  level: string;
  sponsor: string | null;
  wallet: { activated: boolean; activatedAt?: string; opening: number; balance: number };
  orders: OrderLine[];
  commissions: { orderId: string; level: number; rate: number; amount: number; status: string }[];
  corrections: { orderId: string; amount: number; reference: string }[];
  sharing: { id: string; period: string; reference: string; profit: number; memberShare: number; capitalReturned: number; status: string }[];
  remainingPrincipal: number;
};
export type InvestorPortal = {
  kind: "investor";
  tenant: string;
  name: string;
  code: string;
  allocations: { member: string; amount: number }[];
  receipts: { period: string; member: string; capitalReturned: number; profitShare: number; total: number }[];
  receiptError: string | null;
};

const available = (b: number | { available: number }) => (typeof b === "number" ? b : b.available);

function orderStatus(o: any, paid: string[]) {
  if (o.cancelledAt) return o.walletRefund ? "Dibatalkan · saldo dikembalikan" : "Dibatalkan";
  if (o.receivedAt) return "Diterima pelanggan";
  if (o.dispatchedAt) return "Dikirim";
  if (paid.includes(o.id)) return "Lunas · menunggu pengiriman";
  return "Belum dibayar";
}

async function linkedId(user: SessionUser, column: "member_id" | "investor_id") {
  const row = (await pool().query(`SELECT ${column} AS id FROM sajada.app_user WHERE id=$1`, [user.id])).rows[0];
  if (!row?.id) throw new UserError("Akun ini belum terhubung ke data koperasi.");
  return row.id as string;
}

export async function memberPortal(user: SessionUser): Promise<MemberPortal> {
  const tenant = user.tenants[0];
  const memberId = await linkedId(user, "member_id");
  const person = await inTenant(tenant, async (c, t) => (await c.query("SELECT name FROM sajada.member WHERE tenant_id=$1 AND id=$2", [t, memberId])).rows[0]);
  if (!person) throw new UserError("Data anggota untuk akun ini tidak ditemukan.");
  const name: string = person.name;
  const { sections } = await loadWorkspace(tenant);
  const main = sections["sajada-v2"] as any;
  const member = (main.members as any[]).find((m) => m[0] === name);
  const orders: any[] = main.orders, paid: string[] = main.paid;
  const records = (sections["sajada-member-capital"] ?? {}) as Record<string, CapitalRecord>;
  const record = records[name];
  const numbers = sections["sajada-member-numbers"] as NumberState | null;
  const network = (sections["sajada-network"] ?? {}) as Record<string, string | null>;
  const commissionData = (sections["sajada-commissions"] ?? {}) as any;
  const statuses: Record<string, string> = commissionData.statuses ?? {};
  const sales: Sale[] = orders.filter((o) => paid.includes(o.id) && completedForCommission(o, commissionData.delivered ?? []) && o.seller && o.policy === POLICY);
  const reports = ((sections["sajada-tiered-sharing"] ?? []) as any[]).filter((r) => r.member === name);
  const settledReturned = reports.filter((r) => r.status === "settled").reduce((s, r) => s + (r.capitalReturned ?? 0), 0);
  return {
    kind: "member",
    tenant,
    name,
    number: numbers?.issued.find((n) => n.member === name)?.number ?? null,
    area: member?.[2] ?? "",
    level: member?.[3] ?? "",
    sponsor: network[name] ?? null,
    wallet: {
      activated: !!record?.breakdown,
      activatedAt: record?.breakdown?.activatedAt,
      opening: record?.breakdown?.wallet ?? 0,
      balance: record?.breakdown ? available(walletBalance(name, records, orders, tenant)) : 0,
    },
    orders: orders
      .filter((o) => o.seller === name || o.walletPayment?.member === name)
      .map((o) => ({
        id: o.id, date: o.date, total: o.total, status: orderStatus(o, paid),
        as: o.seller === name && o.walletPayment?.member === name ? "penjual & pembeli" : o.seller === name ? "penjual" : "pembeli",
      })),
    commissions: commissions(sales)
      .filter((r) => r.beneficiary === name)
      .map((r) => ({ orderId: r.orderId, level: r.level, rate: r.rate, amount: r.amount, status: statuses[r.id] ?? "pending" })),
    corrections: returnCorrections(sales, main.warehouses)
      .filter((r) => r.beneficiary === name)
      .map((r) => ({ orderId: r.orderId, amount: r.amount, reference: r.returnReference })),
    sharing: reports.map((r) => ({ id: r.id, period: r.period, reference: r.reference, profit: r.profit, memberShare: r.memberShare, capitalReturned: r.capitalReturned, status: r.status })),
    remainingPrincipal: Math.max(INITIAL_PRINCIPAL - settledReturned, 0),
  };
}

export async function investorPortal(user: SessionUser): Promise<InvestorPortal> {
  const tenant = user.tenants[0];
  const investorId = await linkedId(user, "investor_id");
  const { sections } = await loadWorkspace(tenant);
  const funding = (sections["sajada-funding"] ?? { investors: [], allocations: {} }) as { investors: Investor[]; allocations: Record<string, Funding[]> };
  const investor = funding.investors.find((i) => i.id === investorId);
  if (!investor) throw new UserError("Data investor untuk akun ini tidak ditemukan.");
  const allocations = Object.entries(funding.allocations)
    .flatMap(([member, rows]) => rows.filter((r) => r.investorId === investorId).map((r) => ({ member, amount: r.amount })));
  let receipts: InvestorPortal["receipts"] = [], receiptError: string | null = null;
  try {
    receipts = investorReceipts((sections["sajada-tiered-sharing"] ?? []) as any[])
      .filter((r: any) => r.investorId === investorId)
      .map((r: any) => ({ period: r.period, member: r.member, capitalReturned: r.capitalReturned, profitShare: r.profitShare, total: r.total }));
  } catch (e) {
    receiptError = (e as Error).message;
  }
  return { kind: "investor", tenant, name: investor.name, code: investor.code, allocations, receipts, receiptError };
}
