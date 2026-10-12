import { UserError, type Tx } from "../db.ts";
import { clean, memberIds, same } from "./main.ts";

// Workspace sections other than "sajada-v2". Member numbers, investors and the MLM sponsor
// tree live on domain tables (append-only where the database says so); the other sections
// use the web_* tables from migration 022 and are rewritten as a whole on each save.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
export type Section = {
  read(c: Tx, t: string): Promise<unknown>;
  save(c: Tx, t: string, before: any, next: any): Promise<void>;
};

const num = (v: unknown) => Number(v);
const opt = <T>(v: T | null) => (v == null ? undefined : v);

async function present(c: Tx, t: string, section: string) {
  return !!(await c.query("SELECT 1 FROM sajada.web_section_presence WHERE tenant_id=$1 AND section=$2", [t, section])).rows[0];
}
async function setPresent(c: Tx, t: string, section: string, on: boolean) {
  if (on) await c.query("INSERT INTO sajada.web_section_presence(tenant_id,section) VALUES($1,$2) ON CONFLICT DO NOTHING", [t, section]);
  else await c.query("DELETE FROM sajada.web_section_presence WHERE tenant_id=$1 AND section=$2", [t, section]);
}
async function members(c: Tx, t: string) {
  const ids = await memberIds(c, t);
  return {
    id(name: unknown) {
      const id = ids.byName.get(String(name));
      if (!id) throw new UserError("Anggota tidak ditemukan.");
      return id;
    },
    name: (id: string) => ids.byId.get(id) ?? id,
  };
}
async function clear(c: Tx, t: string, tables: string[]) {
  for (const table of tables) await c.query(`DELETE FROM sajada.${table} WHERE tenant_id=$1`, [t]);
}

// ---------- sajada-capital-fees ----------
const capitalFees: Section = {
  async read(c, t) {
    const r = (await c.query("SELECT * FROM sajada.web_capital_fee_plan WHERE tenant_id=$1", [t])).rows[0];
    return r ? { memberDues: num(r.member_dues), adminFee: num(r.admin_fee), other: num(r.other), note: r.note } : null;
  },
  async save(c, t, _before, next) {
    await clear(c, t, ["web_capital_fee_plan"]);
    if (next) await c.query("INSERT INTO sajada.web_capital_fee_plan(tenant_id,member_dues,admin_fee,other,note) VALUES($1,$2,$3,$4,$5)", [t, next.memberDues, next.adminFee, next.other, next.note]);
  },
};

// ---------- sajada-member-capital ----------
const memberCapital: Section = {
  async read(c, t) {
    if (!(await present(c, t, "sajada-member-capital"))) return null;
    const m = await members(c, t);
    const out: Row = {};
    for (const r of (await c.query("SELECT * FROM sajada.web_member_capital WHERE tenant_id=$1 ORDER BY seq", [t])).rows) {
      const name = m.name(r.member_id);
      out[name] = clean({
        member: name, status: r.status, reference: opt(r.reference), date: opt(r.disbursed_on),
        breakdown: r.wallet == null ? undefined : {
          version: 1, wallet: num(r.wallet),
          fees: { memberDues: num(r.fee_member_dues), adminFee: num(r.fee_admin), other: num(r.fee_other), note: r.fee_note },
          actor: r.activated_by, activatedAt: r.activated_at,
        },
      });
    }
    return out;
  },
  async save(c, t, _before, next) {
    await clear(c, t, ["web_member_capital"]);
    await setPresent(c, t, "sajada-member-capital", next != null);
    if (!next) return;
    const m = await members(c, t);
    for (const r of Object.values(next) as Row[]) {
      const b = r.breakdown;
      await c.query(
        "INSERT INTO sajada.web_member_capital(tenant_id,member_id,status,disbursed_on,reference,wallet,fee_member_dues,fee_admin,fee_other,fee_note,activated_at,activated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [t, m.id(r.member), r.status, r.date ?? null, r.reference ?? null, b?.wallet ?? null, b?.fees.memberDues ?? null, b?.fees.adminFee ?? null, b?.fees.other ?? null, b?.fees.note ?? null, b?.activatedAt ?? null, b?.actor ?? null],
      );
    }
  },
};

// ---------- sajada-funding ----------
const funding: Section = {
  async read(c, t) {
    if (!(await present(c, t, "sajada-funding"))) return null;
    const m = await members(c, t);
    const investors = (await c.query("SELECT id,name,code FROM sajada.investor WHERE tenant_id=$1 AND code IS NOT NULL ORDER BY seq", [t])).rows.map((r) => ({ id: r.id, name: r.name, code: r.code }));
    const allocations: Row = {};
    for (const r of (await c.query("SELECT member_id,investor_id,investor_name,amount FROM sajada.web_funding_allocation WHERE tenant_id=$1 ORDER BY min(seq) OVER (PARTITION BY member_id),position", [t])).rows)
      (allocations[m.name(r.member_id)] ??= []).push({ investorId: r.investor_id, investorName: r.investor_name, amount: num(r.amount) });
    return { investors, allocations };
  },
  async save(c, t, before, next) {
    const old: Row[] = before?.investors ?? [];
    const kept = new Set((next?.investors ?? []).map((i: Row) => i.id));
    if (old.some((i) => !kept.has(i.id))) throw new UserError("Investor yang sudah tersimpan tidak dapat dihapus.");
    for (const i of next?.investors ?? []) {
      const prev = old.find((o) => o.id === i.id);
      if (!prev) await c.query("INSERT INTO sajada.investor(tenant_id,id,name,code) VALUES($1,$2,$3,$4)", [t, i.id, i.name, i.code]);
      else if (!same(prev, i)) await c.query("UPDATE sajada.investor SET name=$3,code=$4 WHERE tenant_id=$1 AND id=$2", [t, i.id, i.name, i.code]);
    }
    await clear(c, t, ["web_funding_allocation"]);
    await setPresent(c, t, "sajada-funding", next != null);
    if (!next) return;
    const m = await members(c, t);
    for (const [name, rows] of Object.entries(next.allocations as Record<string, Row[]>))
      for (const [position, r] of rows.entries())
        await c.query("INSERT INTO sajada.web_funding_allocation(tenant_id,member_id,position,investor_id,investor_name,amount) VALUES($1,$2,$3,$4,$5,$6)", [t, m.id(name), position, r.investorId, r.investorName, r.amount]);
  },
};

// ---------- sajada-tiered-sharing ----------
const tieredSharing: Section = {
  async read(c, t) {
    if (!(await present(c, t, "sajada-tiered-sharing"))) return null;
    const m = await members(c, t);
    const segments = new Map<string, Row[]>(), fundingRows = new Map<string, Row[]>();
    for (const s of (await c.query("SELECT * FROM sajada.web_profit_segment WHERE tenant_id=$1 ORDER BY report_id,position", [t])).rows)
      (segments.get(s.report_id) ?? segments.set(s.report_id, []).get(s.report_id)!).push({
        label: s.label, profit: num(s.profit), memberPercent: num(s.member_percent), investorPercent: num(s.investor_percent),
        memberShare: num(s.member_share), investorShare: num(s.investor_share), capitalReturned: num(s.capital_returned),
      });
    for (const f of (await c.query("SELECT * FROM sajada.web_profit_report_funding WHERE tenant_id=$1 ORDER BY report_id,position", [t])).rows)
      (fundingRows.get(f.report_id) ?? fundingRows.set(f.report_id, []).get(f.report_id)!).push({ investorId: f.investor_id, investorName: f.investor_name, amount: num(f.amount) });
    // Field order follows allocateTiered() in shared/tiered-sharing.ts; the backup check compares
    // before/after/segments as serialised text.
    return (await c.query("SELECT * FROM sajada.web_profit_report WHERE tenant_id=$1 ORDER BY seq DESC", [t])).rows.map((r) => clean({
      funding: r.has_funding ? fundingRows.get(r.id) ?? [] : undefined,
      id: r.id, member: m.name(r.member_id), period: r.period, reference: r.reference, revenue: num(r.revenue), cost: num(r.cost), status: r.status,
      policy: r.policy, profit: num(r.profit), segments: segments.get(r.id) ?? [],
      memberShare: num(r.member_share), investorShare: num(r.investor_share), capitalReturned: num(r.capital_returned), investorProfitShare: num(r.investor_profit_share),
      before: { remainingPrincipal: num(r.before_remaining), postRecoveryProfit: num(r.before_post_recovery) },
      after: { remainingPrincipal: num(r.after_remaining), postRecoveryProfit: num(r.after_post_recovery) },
      settlementRef: opt(r.settlement_ref),
    }));
  },
  async save(c, t, _before, next) {
    await clear(c, t, ["web_profit_report"]);
    await setPresent(c, t, "sajada-tiered-sharing", next != null);
    if (!next) return;
    const m = await members(c, t);
    // Newest first in the app; insert oldest first so seq keeps the order.
    for (const r of [...(next as Row[])].reverse()) {
      await c.query(
        `INSERT INTO sajada.web_profit_report(tenant_id,id,member_id,period,reference,revenue,cost,status,settlement_ref,policy,profit,member_share,investor_share,capital_returned,investor_profit_share,
          before_remaining,before_post_recovery,after_remaining,after_post_recovery,has_funding) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [t, r.id, m.id(r.member), r.period, r.reference, r.revenue, r.cost, r.status, r.settlementRef ?? null, r.policy, r.profit, r.memberShare, r.investorShare, r.capitalReturned, r.investorProfitShare,
          r.before.remainingPrincipal, r.before.postRecoveryProfit, r.after.remainingPrincipal, r.after.postRecoveryProfit, Array.isArray(r.funding)],
      );
      for (const [i, s] of (r.segments as Row[]).entries())
        await c.query("INSERT INTO sajada.web_profit_segment(tenant_id,report_id,position,label,profit,member_percent,investor_percent,member_share,investor_share,capital_returned) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [t, r.id, i, s.label, s.profit, s.memberPercent, s.investorPercent, s.memberShare, s.investorShare, s.capitalReturned]);
      for (const [i, f] of ((r.funding ?? []) as Row[]).entries())
        await c.query("INSERT INTO sajada.web_profit_report_funding(tenant_id,report_id,position,investor_id,investor_name,amount) VALUES($1,$2,$3,$4,$5,$6)", [t, r.id, i, f.investorId, f.investorName, f.amount]);
    }
  },
};

// ---------- sajada-profit-sharing (earlier flat records) ----------
const legacySharing: Section = {
  async read(c, t) {
    if (!(await present(c, t, "sajada-profit-sharing"))) return null;
    return (await c.query("SELECT * FROM sajada.web_legacy_profit_share WHERE tenant_id=$1 ORDER BY seq", [t])).rows.map((r) => ({
      id: r.id, member: r.member_name, period: r.period, reference: r.reference, revenue: num(r.revenue), cost: num(r.cost), profit: num(r.profit),
      distributable: num(r.distributable), memberPercent: num(r.member_percent), investorPercent: num(r.investor_percent),
      memberShare: num(r.member_share), investorShare: num(r.investor_share), at: r.at,
    }));
  },
  async save(c, t, _before, next) {
    await clear(c, t, ["web_legacy_profit_share"]);
    await setPresent(c, t, "sajada-profit-sharing", next != null);
    for (const r of (next ?? []) as Row[])
      await c.query("INSERT INTO sajada.web_legacy_profit_share(tenant_id,id,member_name,period,reference,revenue,cost,profit,distributable,member_percent,investor_percent,member_share,investor_share,at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
        [t, r.id, r.member, r.period, r.reference, r.revenue, r.cost, r.profit, r.distributable, r.memberPercent, r.investorPercent, r.memberShare, r.investorShare, r.at]);
  },
};

// ---------- sajada-network (member.sponsor_id) ----------
const network: Section = {
  async read(c, t) {
    if (!(await present(c, t, "sajada-network"))) return null;
    const m = await members(c, t);
    const out: Row = {};
    for (const r of (await c.query("SELECT id,sponsor_id FROM sajada.member WHERE tenant_id=$1 AND network_seq IS NOT NULL ORDER BY network_seq", [t])).rows)
      out[m.name(r.id)] = r.sponsor_id ? m.name(r.sponsor_id) : null;
    return out;
  },
  async save(c, t, _before, next) {
    const m = await members(c, t);
    await c.query("UPDATE sajada.member SET sponsor_id=NULL,network_seq=NULL WHERE tenant_id=$1 AND (sponsor_id IS NOT NULL OR network_seq IS NOT NULL)", [t]);
    await setPresent(c, t, "sajada-network", next != null);
    for (const [i, [name, sponsor]] of Object.entries((next ?? {}) as Record<string, string | null>).entries())
      await c.query("UPDATE sajada.member SET sponsor_id=$3,network_seq=$4 WHERE tenant_id=$1 AND id=$2", [t, m.id(name), sponsor ? m.id(sponsor) : null, i + 1]);
  },
};

// ---------- sajada-commissions ----------
const commissions: Section = {
  async read(c, t) {
    if (!(await present(c, t, "sajada-commissions"))) return null;
    const delivered = (await c.query("SELECT o.reference FROM sajada.web_commission_delivered d JOIN sajada.sales_order o ON o.tenant_id=d.tenant_id AND o.id=d.order_id WHERE d.tenant_id=$1 ORDER BY d.seq", [t])).rows.map((r) => r.reference);
    const statuses = Object.fromEntries((await c.query("SELECT commission_id,status FROM sajada.web_commission_status WHERE tenant_id=$1 ORDER BY seq", [t])).rows.map((r) => [r.commission_id, r.status]));
    const review = (await c.query("SELECT has_corrections FROM sajada.web_commission_review WHERE tenant_id=$1", [t])).rows[0];
    const correctionApprovals = review?.has_corrections
      ? Object.fromEntries((await c.query("SELECT correction_id FROM sajada.web_commission_correction WHERE tenant_id=$1 ORDER BY seq", [t])).rows.map((r) => [r.correction_id, "approved"]))
      : undefined;
    const audit = (await c.query("SELECT at,action,reference,actor FROM sajada.web_commission_audit WHERE tenant_id=$1 ORDER BY seq", [t])).rows.map((r) => ({ at: r.at, action: r.action, reference: r.reference, actor: r.actor }));
    return clean({ delivered, statuses, correctionApprovals, audit });
  },
  async save(c, t, _before, next) {
    await clear(c, t, ["web_commission_delivered", "web_commission_status", "web_commission_correction", "web_commission_audit", "web_commission_review"]);
    await setPresent(c, t, "sajada-commissions", next != null);
    if (!next) return;
    for (const ref of next.delivered as string[]) {
      const order = (await c.query("SELECT id FROM sajada.sales_order WHERE tenant_id=$1 AND reference=$2", [t, ref])).rows[0];
      if (!order) throw new UserError("Pesanan selesai tidak ditemukan.");
      await c.query("INSERT INTO sajada.web_commission_delivered(tenant_id,order_id) VALUES($1,$2)", [t, order.id]);
    }
    for (const [id, status] of Object.entries(next.statuses as Record<string, string>))
      await c.query("INSERT INTO sajada.web_commission_status(tenant_id,commission_id,status) VALUES($1,$2,$3)", [t, id, status]);
    await c.query("INSERT INTO sajada.web_commission_review(tenant_id,has_corrections) VALUES($1,$2)", [t, next.correctionApprovals != null]);
    for (const id of Object.keys(next.correctionApprovals ?? {}))
      await c.query("INSERT INTO sajada.web_commission_correction(tenant_id,correction_id) VALUES($1,$2)", [t, id]);
    for (const a of next.audit as Row[])
      await c.query("INSERT INTO sajada.web_commission_audit(tenant_id,at,action,reference,actor) VALUES($1,$2,$3,$4,$5)", [t, a.at, a.action, a.reference, a.actor]);
  },
};

// ---------- sajada-regions ----------
const regions: Section = {
  async read(c, t) {
    if (!(await present(c, t, "sajada-regions"))) return null;
    const m = await members(c, t);
    const list = (await c.query("SELECT id,name,level,parent_id,code FROM sajada.web_region WHERE tenant_id=$1 ORDER BY seq", [t])).rows
      .map((r) => clean({ id: r.id, name: r.name, level: r.level, parentId: r.parent_id, code: opt(r.code) }));
    const assignments = Object.fromEntries((await c.query("SELECT member_id,region_id FROM sajada.web_region_assignment WHERE tenant_id=$1 ORDER BY seq", [t])).rows.map((r) => [m.name(r.member_id), r.region_id]));
    return { regions: list, assignments };
  },
  async save(c, t, _before, next) {
    await clear(c, t, ["web_region_assignment", "web_region"]);
    await setPresent(c, t, "sajada-regions", next != null);
    if (!next) return;
    const m = await members(c, t);
    for (const r of next.regions as Row[])
      await c.query("INSERT INTO sajada.web_region(tenant_id,id,name,level,parent_id,code) VALUES($1,$2,$3,$4,$5,$6)", [t, r.id, r.name, r.level, r.parentId, r.code ?? null]);
    for (const [name, region] of Object.entries(next.assignments as Record<string, string>))
      await c.query("INSERT INTO sajada.web_region_assignment(tenant_id,member_id,region_id) VALUES($1,$2,$3)", [t, m.id(name), region]);
  },
};

// ---------- sajada-member-numbers (member_number, append-only) ----------
const memberNumbers: Section = {
  async read(c, t) {
    const m = await members(c, t);
    const issued = (await c.query("SELECT * FROM sajada.member_number WHERE tenant_id=$1 ORDER BY issued_at,issue_year,sequence_no", [t])).rows.map((r) => ({
      member: m.name(r.member_id), number: r.number, year: r.issue_year, sequence: r.sequence_no,
      provinceCode: r.province_code, regencyCode: r.regency_code, districtCode: r.district_code, issuedAt: new Date(r.issued_at).toISOString(),
    }));
    const counters = Object.fromEntries((await c.query("SELECT issue_year,last_value FROM sajada.member_number_counter WHERE tenant_id=$1 ORDER BY issue_year", [t])).rows.map((r) => [String(r.issue_year), num(r.last_value)]));
    return issued.length || Object.keys(counters).length ? { counters, issued } : null;
  },
  async save(c, t, before, next) {
    const oldIssued: Row[] = before?.issued ?? [], issued: Row[] = next?.issued ?? [];
    const kept = new Map(issued.map((r) => [r.member, r]));
    if (oldIssued.some((r) => !same(kept.get(r.member), r))) throw new UserError("Nomor anggota yang sudah terbit tidak dapat diubah atau dihapus.");
    const m = await members(c, t);
    const oldCounters: Record<string, number> = before?.counters ?? {};
    for (const [year, value] of Object.entries((next?.counters ?? {}) as Record<string, number>)) {
      const prev = oldCounters[year];
      if (prev === undefined) await c.query("INSERT INTO sajada.member_number_counter(tenant_id,issue_year,last_value) VALUES($1,$2,$3)", [t, Number(year), value]);
      else if (value !== prev) await c.query("UPDATE sajada.member_number_counter SET last_value=$3 WHERE tenant_id=$1 AND issue_year=$2", [t, Number(year), value]);
    }
    if (Object.keys(oldCounters).some((y) => !(y in (next?.counters ?? {})))) throw new UserError("Counter nomor anggota tidak dapat dihapus.");
    const had = new Set(oldIssued.map((r) => r.member));
    for (const r of issued) if (!had.has(r.member))
      await c.query("INSERT INTO sajada.member_number(tenant_id,member_id,number,issue_year,sequence_no,province_code,regency_code,district_code,issued_at,issued_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'web')",
        [t, m.id(r.member), r.number, r.year, r.sequence, r.provinceCode, r.regencyCode, r.districtCode, r.issuedAt]);
  },
};

// ---------- sajada-ledger ----------
const ledger: Section = {
  async read(c, t) {
    if (!(await present(c, t, "sajada-ledger"))) return null;
    const bills = (await c.query("SELECT * FROM sajada.web_supplier_bill WHERE tenant_id=$1 ORDER BY seq", [t])).rows.map((r) => clean({
      id: r.id, supplier: r.supplier, reference: r.reference, date: r.date, due: r.due, currency: r.currency, amount: num(r.amount), rate: num(r.rate), base: num(r.base),
      account: r.account, receiptId: opt(r.receipt_id), poId: opt(r.po_id), quantity: r.quantity == null ? undefined : num(r.quantity),
      unitCost: r.unit_cost == null ? undefined : num(r.unit_cost), createdAt: opt(r.created_at), createdBy: opt(r.created_by),
    }));
    const payments = (await c.query("SELECT * FROM sajada.web_supplier_bill_payment WHERE tenant_id=$1 ORDER BY seq", [t])).rows.map((r) => clean({
      id: r.id, billId: r.bill_id, amount: num(r.amount), date: r.date, reference: opt(r.reference), actor: opt(r.actor), at: opt(r.at),
    }));
    const capital = (await c.query("SELECT * FROM sajada.web_capital_deposit WHERE tenant_id=$1 ORDER BY seq", [t])).rows.map((r) => ({ id: r.id, amount: num(r.amount), date: r.date, note: r.note }));
    return { bills, payments, capital };
  },
  async save(c, t, _before, next) {
    await clear(c, t, ["web_supplier_bill_payment", "web_supplier_bill", "web_capital_deposit"]);
    await setPresent(c, t, "sajada-ledger", next != null);
    if (!next) return;
    for (const b of next.bills as Row[])
      await c.query("INSERT INTO sajada.web_supplier_bill(tenant_id,id,supplier,reference,date,due,currency,amount,rate,base,account,receipt_id,po_id,quantity,unit_cost,created_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",
        [t, b.id, b.supplier, b.reference, b.date, b.due, b.currency, b.amount, b.rate, b.base, b.account, b.receiptId ?? null, b.poId ?? null, b.quantity ?? null, b.unitCost ?? null, b.createdAt ?? null, b.createdBy ?? null]);
    for (const p of next.payments as Row[])
      await c.query("INSERT INTO sajada.web_supplier_bill_payment(tenant_id,id,bill_id,amount,date,reference,actor,at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [t, p.id, p.billId, p.amount, p.date, p.reference ?? null, p.actor ?? null, p.at ?? null]);
    for (const k of next.capital as Row[])
      await c.query("INSERT INTO sajada.web_capital_deposit(tenant_id,id,amount,date,note) VALUES($1,$2,$3,$4,$5)", [t, k.id, k.amount, k.date, k.note]);
  },
};

export const SECTION_STORES: Record<string, Section> = {
  "sajada-capital-fees": capitalFees,
  "sajada-network": network,
  "sajada-commissions": commissions,
  "sajada-ledger": ledger,
  "sajada-member-capital": memberCapital,
  "sajada-profit-sharing": legacySharing,
  "sajada-tiered-sharing": tieredSharing,
  "sajada-funding": funding,
  "sajada-regions": regions,
  "sajada-member-numbers": memberNumbers,
};
