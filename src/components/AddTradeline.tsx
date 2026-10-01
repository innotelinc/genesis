"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const KINDS = [
  { value: "net30", label: "Net-30 vendor" },
  { value: "revolving", label: "Revolving line" },
  { value: "installment", label: "Installment" },
  { value: "card", label: "Business card" },
];

const BUREAUS = [
  { value: "dnb", label: "D&B" },
  { value: "experian", label: "Experian" },
  { value: "equifax", label: "Equifax" },
];

/**
 * Records a tradeline. `inBusinessName` is the field that matters most — a line
 * the owner holds personally builds the owner's file, not the business's, and
 * the model excludes it, so the form asks rather than assumes.
 */
export default function AddTradeline({ businessId }: { businessId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [lender, setLender] = useState("");
  const [kind, setKind] = useState("net30");
  const [limit, setLimit] = useState("");
  const [balance, setBalance] = useState("");
  const [openedAt, setOpenedAt] = useState("");
  const [reportsTo, setReportsTo] = useState<string[]>([]);
  const [inBusinessName, setInBusinessName] = useState(true);

  function toggleBureau(value: string) {
    setReportsTo((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/businesses/${businessId}/credit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lender,
          kind,
          limitCents: limit ? Math.round(Number(limit) * 100) : undefined,
          balanceCents: balance ? Math.round(Number(balance) * 100) : undefined,
          openedAt: openedAt || undefined,
          reportsTo,
          inBusinessName,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMessage(body.error ?? "Could not save the tradeline.");
        return;
      }
      setLender("");
      setLimit("");
      setBalance("");
      setOpenedAt("");
      setReportsTo([]);
      setMessage("Added.");
      router.refresh();
    } catch {
      setMessage("Could not save the tradeline.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="g-btn g-btn-secondary" onClick={() => setOpen(true)} type="button">
        Add a tradeline
      </button>
    );
  }

  return (
    <form className="g-card" onSubmit={submit}>
      <h3 className="mb-4 text-sm uppercase tracking-wide text-neutral-400">New tradeline</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="g-label">Lender / vendor</span>
          <input
            className="g-input"
            onChange={(e) => setLender(e.target.value)}
            required
            value={lender}
          />
        </label>
        <label>
          <span className="g-label">Kind</span>
          <select className="g-input" onChange={(e) => setKind(e.target.value)} value={kind}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="g-label">Limit (USD)</span>
          <input className="g-input" onChange={(e) => setLimit(e.target.value)} value={limit} />
        </label>
        <label>
          <span className="g-label">Balance (USD)</span>
          <input className="g-input" onChange={(e) => setBalance(e.target.value)} value={balance} />
        </label>
        <label>
          <span className="g-label">Opened</span>
          <input
            className="g-input"
            onChange={(e) => setOpenedAt(e.target.value)}
            placeholder="2026-09-29"
            value={openedAt}
          />
        </label>
      </div>

      <div className="mt-4">
        <span className="g-label">Reports to</span>
        <div className="flex flex-wrap gap-4">
          {BUREAUS.map((b) => (
            <label className="flex items-center gap-2 text-sm text-neutral-300" key={b.value}>
              <input
                checked={reportsTo.includes(b.value)}
                onChange={() => toggleBureau(b.value)}
                type="checkbox"
              />
              {b.label}
            </label>
          ))}
        </div>
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm text-neutral-300">
        <input
          checked={inBusinessName}
          onChange={(e) => setInBusinessName(e.target.checked)}
          type="checkbox"
        />
        The line is in the business&apos;s name (uncheck for the owner&apos;s personal credit)
      </label>

      <div className="mt-4 flex items-center gap-3">
        <button className="g-btn g-btn-primary" disabled={busy} type="submit">
          {busy ? "Saving…" : "Save tradeline"}
        </button>
        <button className="g-btn g-btn-secondary" onClick={() => setOpen(false)} type="button">
          Cancel
        </button>
        {message ? <span className="text-xs text-neutral-400">{message}</span> : null}
      </div>
    </form>
  );
}
