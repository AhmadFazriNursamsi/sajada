"use server";

import { redirect } from "next/navigation";
import { currentUser, requireUser, signIn, signOut } from "@/lib/server/auth";
import { changeOwnPassword } from "@/lib/server/users";
import { userMessage } from "@/lib/server/workspace";
import { isStaff } from "@/lib/roles";

export type FormState = { error?: string; done?: string } | null;

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  let home: string;
  try {
    const result = await signIn(String(form.get("username") ?? ""), String(form.get("password") ?? ""));
    if ("error" in result) return { error: result.error };
    home = result.user.mustChangePassword ? "/password" : isStaff(result.user.role) ? "/" : "/portal";
  } catch (error) {
    return { error: userMessage(error) };
  }
  redirect(home);
}

export async function logoutAction(): Promise<void> {
  await signOut();
  redirect("/login");
}

export async function changePasswordAction(_: FormState, form: FormData): Promise<FormState> {
  let home: string;
  try {
    const user = await requireUser();
    const next = String(form.get("next") ?? "");
    if (next !== String(form.get("confirm") ?? "")) return { error: "Konfirmasi password baru tidak sama." };
    await changeOwnPassword(user.id, String(form.get("current") ?? ""), next);
    home = isStaff(user.role) ? "/" : "/portal";
  } catch (error) {
    return { error: userMessage(error) };
  }
  redirect(home);
}

/** The signed-in user for client components (null when signed out). */
export async function whoAmIAction() {
  return currentUser();
}
