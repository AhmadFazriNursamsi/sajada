"use server";

import { headers } from "next/headers";
import { requireStaff } from "@/lib/server/auth";
import { UserError } from "@/lib/server/db";
import {
  approveRegistration, listRegistrations, memberProfiles, pendingCount, publicTenants, registrationRegions,
  rejectRegistration, setMemberProfile, submitRegistration, type MemberProfile,
} from "@/lib/server/registration";
import { userMessage } from "@/lib/server/workspace";
import type { ActionResult } from "./workspace";
import type { FormState } from "./auth";

// ---------- public: the /daftar sign-up page ----------

export async function registrationOptionsAction(tenant: string | null): Promise<ActionResult<{ tenants: string[]; regions: { id: string; label: string }[] }>> {
  try {
    const tenants = await publicTenants();
    const regions = tenant && tenants.includes(tenant) ? await registrationRegions(tenant) : [];
    return { ok: true, data: { tenants, regions } };
  } catch (error) {
    return { ok: false, error: userMessage(error) };
  }
}

export async function submitRegistrationAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    // Bots fill every field; people never see this one.
    if (String(form.get("website") ?? "")) return { done: "Pendaftaran terkirim." };
    const value = (k: string) => String(form.get(k) ?? "");
    if (value("password") !== value("confirm")) return { error: "Konfirmasi password tidak sama." };
    const h = await headers();
    const ip = h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    await submitRegistration(
      { tenant: value("tenant"), name: value("name"), phone: value("phone"), email: value("email"), familyStatus: value("familyStatus"),
        regionId: value("regionId"), area: value("area"), sponsor: value("sponsor"), username: value("username"), password: value("password") },
      ip,
    );
    return { done: "Pendaftaran terkirim. Petugas koperasi akan memeriksa data Anda; setelah disetujui Anda dapat login dengan username dan password tadi." };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

// ---------- staff: Anggota koperasi → Pendaftaran anggota ----------

/** Any staff of the koperasi may see requests; member officers and admins decide. */
async function decider(tenant: string) {
  const user = await requireStaff(tenant);
  if (user.role !== "admin" && user.role !== "member_officer") throw new UserError("Hanya petugas anggota atau admin yang dapat memutuskan pendaftaran dan mengubah profil anggota.");
  return user;
}
async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error: userMessage(error) };
  }
}

export const listRegistrationsAction = async (tenant: string) => run(async () => { await requireStaff(tenant); return listRegistrations(tenant); });
export const pendingRegistrationsAction = async (tenant: string) => run(async () => { await requireStaff(tenant); return pendingCount(tenant); });
export const approveRegistrationAction = async (tenant: string, id: string, decision: { name: string; sponsor: string | null }) =>
  run(async () => approveRegistration(await decider(tenant), tenant, id, decision));
export const rejectRegistrationAction = async (tenant: string, id: string, note: string) =>
  run(async () => rejectRegistration(await decider(tenant), tenant, id, note));
export const memberProfilesAction = async (tenant: string) => run(async () => { await requireStaff(tenant); return memberProfiles(tenant); });
export const setMemberProfileAction = async (tenant: string, name: string, profile: MemberProfile) =>
  run(async () => { await decider(tenant); return setMemberProfile(tenant, name, profile); });
