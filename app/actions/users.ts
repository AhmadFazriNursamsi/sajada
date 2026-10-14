"use server";

import { requireUser } from "@/lib/server/auth";
import { UserError } from "@/lib/server/db";
import { createUser, listPeople, listUsers, resetPassword, updateUser, type UserInput, type UserRow } from "@/lib/server/users";
import { userMessage } from "@/lib/server/workspace";
import type { ActionResult } from "./workspace";

// Account management: admin only (Pengaturan → Pengguna & akses).
async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin" || user.mustChangePassword) throw new UserError("Hanya admin yang dapat mengelola pengguna.");
  return user;
}

async function run<T>(fn: (adminId: string) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const admin = await requireAdmin();
    return { ok: true, data: await fn(admin.id) };
  } catch (error) {
    return { ok: false, error: userMessage(error) };
  }
}

export const listUsersAction = async (): Promise<ActionResult<UserRow[]>> => run(() => listUsers());
export const listPeopleAction = async (tenant: string) => run(() => listPeople(tenant));
export const createUserAction = async (input: UserInput, password: string) => run((admin) => createUser(admin, input, password));
export const updateUserAction = async (id: string, input: UserInput & { active: boolean }) => run((admin) => updateUser(admin, id, input));
export const resetPasswordAction = async (id: string, password: string) => run((admin) => resetPassword(admin, id, password));
