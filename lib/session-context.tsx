"use client";

import { createContext, useContext } from "react";
import type { SessionUser } from "./roles";

// The signed-in user for the workspace's client components (set by components/Workspace.tsx).
export const SessionContext = createContext<SessionUser | null>(null);

export function useSession(): SessionUser {
  const user = useContext(SessionContext);
  if (!user) throw new Error("SessionContext belum tersedia.");
  return user;
}

/** Name recorded as the actor (pelaksana) of changes made by the signed-in user. */
export const useActor = () => useSession().name;
