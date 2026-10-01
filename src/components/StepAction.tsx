"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Runs one step. The browser never decides what may be automated — it posts and
 * renders whichever refusal or result the server returns, so the policy lives in
 * exactly one place.
 */
export default function StepAction({
  businessId,
  stepKey,
  label,
  variant = "primary",
  disabled = false,
}: {
  businessId: string;
  stepKey: string;
  label: string;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/businesses/${businessId}/steps/${stepKey}`, { method: "POST" });
      const body = (await res.json()) as {
        result?: { detail?: string };
        error?: string;
        blockers?: string[];
        code?: string;
      };

      if (!res.ok) {
        setMessage(
          body.blockers?.length
            ? `${body.error} Blocked by: ${body.blockers.join(", ")}.`
            : (body.error ?? "The step failed."),
        );
      } else {
        setMessage(body.result?.detail ?? "Step completed.");
      }
      router.refresh();
    } catch {
      setMessage("The request could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        className={`g-btn ${variant === "primary" ? "g-btn-primary" : "g-btn-secondary"}`}
        disabled={disabled || busy}
        onClick={run}
        type="button"
      >
        {busy ? "Working…" : label}
      </button>
      {message ? <p className="mt-2 text-xs text-neutral-400">{message}</p> : null}
    </div>
  );
}
