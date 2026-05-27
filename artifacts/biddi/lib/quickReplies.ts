import {
  getMyQuickReplies,
  updateMyQuickReplies,
} from "@workspace/api-client-react";
import { getJSON, setJSON } from "@/lib/storage";

export type ChatRole = "driver" | "rider";

export const DEFAULT_DRIVER_QUICK_REPLIES: readonly string[] = [
  "I'm on my way",
  "I've arrived",
  "I'm outside",
  "Running a few minutes late",
  "Please come to the pickup point",
  "Thank you!",
] as const;

export const DEFAULT_RIDER_QUICK_REPLIES: readonly string[] = [
  "I'm coming out now",
  "I'll be there in a minute",
  "Please wait, almost there",
  "Where are you?",
  "Thank you!",
] as const;

export const MAX_QUICK_REPLIES = 12;
export const MAX_QUICK_REPLY_LENGTH = 60;

export function getDefaultQuickReplies(role: ChatRole): string[] {
  return (role === "driver"
    ? DEFAULT_DRIVER_QUICK_REPLIES
    : DEFAULT_RIDER_QUICK_REPLIES
  ).slice();
}

/**
 * @deprecated Prefer {@link loadQuickReplies} so user customisations are honoured.
 * Retained for callers that need a synchronous default list.
 */
export function getQuickReplies(role: ChatRole): readonly string[] {
  return role === "driver"
    ? DEFAULT_DRIVER_QUICK_REPLIES
    : DEFAULT_RIDER_QUICK_REPLIES;
}

type StoredReplies = { driver?: string[]; rider?: string[] };

function cacheKey(userId: string): string {
  return `quick_replies:${userId}`;
}

function sanitize(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    out.push(trimmed.slice(0, MAX_QUICK_REPLY_LENGTH));
    if (out.length >= MAX_QUICK_REPLIES) break;
  }
  return out;
}

async function readCache(userId: string): Promise<StoredReplies> {
  return (await getJSON<StoredReplies>(cacheKey(userId))) ?? {};
}

async function writeCache(userId: string, value: StoredReplies): Promise<void> {
  await setJSON(cacheKey(userId), value);
}

/**
 * Load a user's customised quick replies for the given role from the server,
 * falling back to a local cache (for offline) and then the built-in defaults.
 * The server is the source of truth so edits sync across devices for the same
 * authenticated account.
 */
export async function loadQuickReplies(
  userId: string,
  role: ChatRole,
): Promise<string[]> {
  if (!userId) return getDefaultQuickReplies(role);
  try {
    const remote = await getMyQuickReplies();
    const next: StoredReplies = {
      driver: sanitize(remote.driver),
      rider: sanitize(remote.rider),
    };
    await writeCache(userId, next);
    const list = next[role] ?? [];
    return list.length > 0 ? list : getDefaultQuickReplies(role);
  } catch {
    const cached = await readCache(userId);
    const list = sanitize(cached[role]);
    return list.length > 0 ? list : getDefaultQuickReplies(role);
  }
}

/**
 * Persist a user's quick reply list for one role to the server. Empty/whitespace
 * entries are dropped and entries are clipped to {@link MAX_QUICK_REPLY_LENGTH}.
 * The local cache is updated to match the server response.
 */
export async function saveQuickReplies(
  userId: string,
  role: ChatRole,
  replies: string[],
): Promise<string[]> {
  if (!userId) return getDefaultQuickReplies(role);
  const cleaned = sanitize(replies);
  const remote = await updateMyQuickReplies({ role, replies: cleaned });
  const next: StoredReplies = {
    driver: sanitize(remote.driver),
    rider: sanitize(remote.rider),
  };
  await writeCache(userId, next);
  const list = next[role] ?? [];
  return list.length > 0 ? list : getDefaultQuickReplies(role);
}

/**
 * Restore the built-in defaults for one role and persist them to the server so
 * the user's list visibly resets in the chat strip across all their devices.
 */
export async function resetQuickReplies(
  userId: string,
  role: ChatRole,
): Promise<string[]> {
  const defaults = getDefaultQuickReplies(role);
  return await saveQuickReplies(userId, role, defaults);
}
