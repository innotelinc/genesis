"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Hands a generated packet to Signara so the owner can sign it there.
 *
 * The button only appears when the server says Signara is configured, and the
 * decision to accept the packet is Signara's — the browser just posts and
 * renders the answer.
 */
export default function SendToSignara({
  businessId,
  docKey,
}: {
  businessId: string;
  docKey: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/businesses/${businessId}/documents/${docKey}/signara`, {
        method: "POST",
      });
      const body = (await res.json()) as { detail?: string; error?: string };
      setMessage(res.ok ? (body.detail ?? "Sent to Signara.") : (body.error ?? "The hand-off failed."));
      router.refresh();
    } catch {
      setMessage("The request could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button
        className="g-btn g-btn-secondary"
        disabled={busy}
        onClick={send}
        type="button"
      >
        {busy ? "Sending…" : "Send to Signara for signature"}
      </button>
      {message ? <p className="mt-2 text-xs text-neutral-400">{message}</p> : null}
    </span>
  );
}
