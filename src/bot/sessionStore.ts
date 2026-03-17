import { PostSession } from "../types/session";

const sessionStore = new Map<number, PostSession>();

export function getSession(userId: number): PostSession {
  return sessionStore.get(userId) ?? { state: "idle" };
}

export function setSession(userId: number, session: PostSession): void {
  sessionStore.set(userId, session);
}

export function resetSession(userId: number): void {
  sessionStore.set(userId, { state: "idle" });
}
