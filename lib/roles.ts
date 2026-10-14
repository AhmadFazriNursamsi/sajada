// Roles of the web app's sign-in (sajada.app_user.role) and what each may change.
// Shared by the browser (labels, read-only notices) and the server, which enforces the
// rules on every save in lib/server/workspace/authorize.ts.

export const STAFF_ROLES = ["admin", "accountant", "member_officer", "depot_officer", "viewer"] as const;
export const SELF_ROLES = ["member", "investor"] as const;
export const ROLES = [...STAFF_ROLES, ...SELF_ROLES] as const;
export type Role = (typeof ROLES)[number];
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin / pengurus",
  accountant: "Akuntan",
  member_officer: "Petugas anggota & penjualan",
  depot_officer: "Petugas depot & pengadaan",
  viewer: "Pemantau (hanya melihat)",
  member: "Anggota",
  investor: "Investor",
};

export const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as readonly string[]).includes(v);
export const isStaff = (role: Role): role is StaffRole => (STAFF_ROLES as readonly string[]).includes(role);

/**
 * Who may change each workspace section (admin may change everything). "sajada-v2" holds
 * several kinds of data and has finer rules in authorize.ts: members, orders and payments
 * for member_officer (accountant may only mark existing orders paid), catalog and depots for
 * depot_officer, with stock movements of sales and automatic draft POs allowed to the roles
 * whose actions cause them.
 */
export const SECTION_EDITORS: Record<string, readonly StaffRole[]> = {
  "sajada-member-capital": ["member_officer"],
  "sajada-member-numbers": ["member_officer"],
  "sajada-network": ["member_officer"],
  "sajada-regions": ["member_officer"],
  "sajada-capital-fees": ["accountant"],
  "sajada-commissions": ["accountant"],
  "sajada-ledger": ["accountant"],
  "sajada-funding": ["accountant"],
  "sajada-profit-sharing": ["accountant"],
  "sajada-tiered-sharing": ["accountant"],
};

/** Menu (page) → roles that do its main work; others see a read-only notice there. */
export const MENU_EDITORS: Record<string, readonly StaffRole[]> = {
  "Anggota koperasi": ["member_officer"],
  Marketplace: ["member_officer"],
  "Produk & stok": ["depot_officer"],
  "Depot & persediaan": ["depot_officer"],
  "Restok & laporan": ["depot_officer"],
  "Safety stock & PO": ["depot_officer"],
  "Jaringan MLM": ["member_officer"],
  Pendapatan: ["accountant"],
  "Investor & pendanaan": ["accountant"],
  Akuntansi: ["accountant"],
  "Struktur daerah": ["member_officer"],
  Pengaturan: [],
};

export function canEditMenu(role: Role, menu: string): boolean {
  if (role === "admin") return true;
  const editors = MENU_EDITORS[menu];
  return !!editors && (editors as readonly string[]).includes(role);
}

/** The session user as the browser sees it. */
export type SessionUser = {
  id: string;
  username: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
  /** Koperasi this account may open (staff), or its one koperasi (member/investor). */
  tenants: string[];
};
