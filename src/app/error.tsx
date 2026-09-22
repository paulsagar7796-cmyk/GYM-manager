"use client";

import { useEffect } from "react";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f3f5f7] px-6">
      <div className="w-full max-w-md rounded-[26px] border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-black text-slate-900">Something went wrong</h1>
        <p className="mt-2 text-sm font-medium text-slate-500">
          Your saved members are untouched. Try loading the screen again.
        </p>
        <button
          type="button"
          onClick={() => retry()}
          className="mt-5 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white transition active:scale-[0.99]"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
