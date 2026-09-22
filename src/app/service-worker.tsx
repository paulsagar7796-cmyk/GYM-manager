"use client";

import { useEffect } from "react";

/**
 * Registers the app-shell worker. Wrapped in every guard because Safari in
 * private browsing, and any insecure origin, expose no `serviceWorker` at all.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      } catch {
        // Offline support is an enhancement; failing to register must not
        // break the app for this session.
      }
    };

    // After load, so registration never competes with first paint.
    if (document.readyState === "complete") void register();
    else window.addEventListener("load", () => void register(), { once: true });
  }, []);

  return null;
}
