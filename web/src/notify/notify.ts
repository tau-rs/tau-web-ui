import { create } from "zustand";

export type NotifyKind = "error" | "info" | "success";

export interface Notification {
  id: number;
  kind: NotifyKind;
  message: string;
}

interface NotifyState {
  items: Notification[];
  push: (kind: NotifyKind, message: string) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useNotifications = create<NotifyState>((set) => ({
  items: [],
  push: (kind, message) => set((s) => ({ items: [...s.items, { id: ++seq, kind, message }] })),
  dismiss: (id) => set((s) => ({ items: s.items.filter((n) => n.id !== id) })),
}));

/** Add a notification from anywhere — React or not (zustand store, WS handler, ...). */
export function notify(kind: NotifyKind, message: string): void {
  useNotifications.getState().push(kind, message);
}

/** Extract a human-readable message from any thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Surface a failed operation: log it for diagnostics AND show the user a toast.
 * The shared replacement for silent `.catch(() => {})` sites.
 */
export function surfaceError(context: string, err: unknown): void {
  console.error(`${context}:`, err);
  notify("error", `${context}: ${errorMessage(err)}`);
}
