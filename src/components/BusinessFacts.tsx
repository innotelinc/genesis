"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Business } from "@/lib/types";

/**
 * The facts Genesis learns after intake: the state entity ID's date of record,
 * the EIN the responsible party received, the domain, and the number region.
 * Recording them here is what unblocks the steps that depend on them.
 */
export default function BusinessFacts({ business }: { business: Business }) {
  const router = useRouter();
  const [ein, setEin] = useState(business.ein ?? "");
  const [formationDate, setFormationDate] = useState(business.formationDate ?? "");
  const [websiteDomain, setWebsiteDomain] = useState(business.websiteDomain ?? "");
  const [phoneAreaCode, setPhoneAreaCode] = useState(business.phoneAreaCode ?? "");
  const [duns, setDuns] = useState(business.duns ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    const payload: Record<string, string> = {
      ...(ein ? { ein } : {}),
      ...(duns ? { duns } : {}),
      ...(formationDate ? { formationDate } : {}),
      ...(websiteDomain ? { websiteDomain } : {}),
      ...(phoneAreaCode ? { phoneAreaCode } : {}),
    };

    try {
      const res = await fetch(`/api/businesses/${business.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { error?: string };
      setMessage(res.ok ? "Saved." : (body.error ?? "Could not save."));
      if (res.ok) router.refresh();
    } catch {
      setMessage("Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="g-card" onSubmit={save}>
      <h2 className="mb-4 text-sm uppercase tracking-wide text-neutral-400">Record facts</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="g-label">EIN</span>
          <input
            className="g-input"
            onChange={(e) => setEin(e.target.value)}
            placeholder="12-3456789"
            value={ein}
          />
        </label>
        <label>
          <span className="g-label">Formation date</span>
          <input
            className="g-input"
            onChange={(e) => setFormationDate(e.target.value)}
            placeholder="2026-09-29"
            value={formationDate}
          />
        </label>
        <label>
          <span className="g-label">D-U-N-S number</span>
          <input
            className="g-input"
            onChange={(e) => setDuns(e.target.value)}
            placeholder="123456789"
            value={duns}
          />
        </label>
        <label>
          <span className="g-label">Domain</span>
          <input
            className="g-input"
            onChange={(e) => setWebsiteDomain(e.target.value)}
            placeholder="acme.com"
            value={websiteDomain}
          />
        </label>
        <label>
          <span className="g-label">Number area code</span>
          <input
            className="g-input"
            maxLength={3}
            onChange={(e) => setPhoneAreaCode(e.target.value)}
            placeholder="415"
            value={phoneAreaCode}
          />
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button className="g-btn g-btn-secondary" disabled={busy} type="submit">
          {busy ? "Saving…" : "Save facts"}
        </button>
        {message ? <span className="text-xs text-neutral-400">{message}</span> : null}
      </div>
    </form>
  );
}
