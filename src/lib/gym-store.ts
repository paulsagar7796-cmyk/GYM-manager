"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { GymProfile, Member, Payment, PlanType, Product, TemplatePlan } from "@/lib/gym-data";
import {
  emptyState,
  loadState,
  saveState,
  seedState,
  type PersistedState,
} from "@/lib/gym-storage";

/**
 * Members, plans and the affiliate catalog live in a small external store rather than component state
 * so `useSyncExternalStore` can hand the server one snapshot and the browser
 * another. That keeps the prerendered HTML and the first client render
 * identical while still restoring saved data, with no effect that sets state.
 *
 * This is the seam a Supabase-backed data layer would replace later.
 */
let snapshot: PersistedState | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): PersistedState {
  // Cached: useSyncExternalStore re-reads on every render and would loop
  // forever if this returned a fresh object each time.
  if (snapshot === null) snapshot = loadState() ?? emptyState;
  return snapshot;
}

function getServerSnapshot(): PersistedState {
  return emptyState;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function commit(next: PersistedState): void {
  snapshot = next;
  saveState(next);
  for (const listener of listeners) listener();
}

export function useAppState(): PersistedState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function updateMembers(update: (prev: Member[]) => Member[]): void {
  const state = getSnapshot();
  commit({ ...state, members: update(state.members) });
}

/** A renewal is money in: it moves the expiry and records the payment together. */
export function recordRenewal(member: Member, payment: Payment): void {
  const state = getSnapshot();

  commit({
    ...state,
    members: state.members.map((item) => (item.id === member.id ? member : item)),
    payments: [...state.payments, payment],
  });
}

/** Undoes the most recent renewal, restoring the exact previous expiry. */
export function undoPayment(paymentId: string): void {
  const state = getSnapshot();
  const payment = state.payments.find((item) => item.id === paymentId);
  if (!payment) return;

  commit({
    ...state,
    payments: state.payments.filter((item) => item.id !== paymentId),
    members: state.members.map((item) =>
      item.id === payment.member_id
        ? { ...item, valid_until: payment.previous_valid_until }
        : item,
    ),
  });
}

export function saveProfile(profile: GymProfile): void {
  const state = getSnapshot();
  commit({ ...state, profile });
}

/** Replaces one member in place, used when the owner edits their details. */
export function saveMember(member: Member): void {
  updateMembers((members) => members.map((item) => (item.id === member.id ? member : item)));
}

/**
 * Removes a member. Recommendations already sent to them are kept: they are a
 * record of what actually went out, and the affiliate tables treat the member
 * as nullable for exactly this reason.
 */
export function deleteMember(memberId: string): void {
  updateMembers((members) => members.filter((member) => member.id !== memberId));
}

export function assignPlan(memberId: string, type: PlanType, planId: string | null): void {
  const field = type === "workout" ? "workout_plan_id" : "nutrition_plan_id";

  updateMembers((members) =>
    members.map((member) => (member.id === memberId ? { ...member, [field]: planId } : member)),
  );
}

/** Adds a new plan, or replaces one with the same id when editing. */
export function savePlan(plan: TemplatePlan): void {
  const state = getSnapshot();
  const exists = state.plans.some((item) => item.id === plan.id);

  commit({
    ...state,
    plans: exists
      ? state.plans.map((item) => (item.id === plan.id ? plan : item))
      : [...state.plans, plan],
  });
}

/** Also clears the plan off every member, so no card points at a missing plan. */
export function deletePlan(planId: string): void {
  const state = getSnapshot();

  commit({
    ...state,
    plans: state.plans.filter((plan) => plan.id !== planId),
    members: state.members.map((member) => ({
      ...member,
      workout_plan_id: member.workout_plan_id === planId ? null : member.workout_plan_id,
      nutrition_plan_id: member.nutrition_plan_id === planId ? null : member.nutrition_plan_id,
    })),
  });
}

/** Adds a new product, or replaces one with the same id when editing. */
export function saveProduct(product: Product): void {
  const state = getSnapshot();
  const exists = state.products.some((item) => item.id === product.id);

  commit({
    ...state,
    products: exists
      ? state.products.map((item) => (item.id === product.id ? product : item))
      : [...state.products, product],
  });
}

/** Hides a product from the recommend list without losing its history. */
export function toggleProduct(productId: string): void {
  const state = getSnapshot();

  commit({
    ...state,
    products: state.products.map((product) =>
      product.id === productId ? { ...product, is_active: !product.is_active } : product,
    ),
  });
}

/** Past recommendations are kept: they are a record of what was actually sent. */
export function deleteProduct(productId: string): void {
  const state = getSnapshot();
  commit({ ...state, products: state.products.filter((product) => product.id !== productId) });
}

export function recordRecommendation(memberId: string, productId: string): void {
  const state = getSnapshot();

  commit({
    ...state,
    recommendations: [
      ...state.recommendations,
      {
        id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        member_id: memberId,
        product_id: productId,
        sent_at: new Date().toISOString(),
      },
    ],
  });
}

/** Loads the demo gym over whatever is there. Explicit action only. */
export function loadSampleData(): void {
  commit(seedState);
}

/** Wipes back to an empty gym. */
export function clearAllData(): void {
  commit(emptyState);
}

/** True while the app is still showing its untouched starting state. */
export function isUntouched(state: PersistedState): boolean {
  return state.members.length === 0 && state.products.length === 0;
}

/** Swaps the whole dataset in, used by a restore. */
export function replaceState(state: PersistedState): void {
  commit(state);
}

export type StorageStatus = "unknown" | "protected" | "unprotected" | "unsupported";

/**
 * Asks the browser not to evict this site's data when the device runs low on
 * space. Without it, everything here is "best effort" storage the browser may
 * discard on its own. It does nothing for a lost or replaced phone, which is
 * what the backup file is for.
 */
export function usePersistentStorage(): StorageStatus {
  const [status, setStatus] = useState<StorageStatus>("unknown");

  useEffect(() => {
    let cancelled = false;

    // Every setState below sits in an async callback on purpose: this effect
    // synchronises with an external system, it does not drive a render.
    const request = async () => {
      try {
        if (typeof navigator === "undefined" || !navigator.storage?.persist) {
          if (!cancelled) setStatus("unsupported");
          return;
        }

        const already = await navigator.storage.persisted();
        const granted = already || (await navigator.storage.persist());
        if (!cancelled) setStatus(granted ? "protected" : "unprotected");
      } catch {
        if (!cancelled) setStatus("unsupported");
      }
    };

    void request();

    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}

const neverChanges = () => () => {};

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

/**
 * Live connectivity. Reported as online during the server render so the
 * prerendered HTML never ships an offline banner.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * False through the server render and the hydrating render, true afterwards.
 * Gate anything clock-dependent on it: this page is prerendered at build time,
 * so reading the date during render would freeze build-day values into the HTML
 * and disagree with the browser.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    neverChanges,
    () => true,
    () => false,
  );
}
