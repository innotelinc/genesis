"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EinFiling as EinFilingRecord } from "@/lib/types";

/**
 * The EIN filing panel.
 *
 * It records the third-party-designee authorization — who is filing for the
 * business, and the responsible party's signature — and stores the signed Form
 * SS-4 that Genesis will transmit. Recording this is not a filing: the EIN step
 * still has to be run, and it will not fax until both the authorization and the
 * signed copy are on file.
 */
export default function EinFiling({
  businessId,
  filing,
}: {
  businessId: string;
  filing?: EinFilingRecord;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [designeeName, setDesigneeName] = useState(filing?.designeeName ?? "");
  const [designeePhone, setDesigneePhone] = useState(filing?.designeePhone ?? "");
  const [designeeFax, setDesigneeFax] = useState(filing?.designeeFax ?? "");
  const [designeeAddress, setDesigneeAddress] = useState(filing?.designeeAddress ?? "");
  const [signaraDocumentId, setSignaraDocumentId] = useState(
    filing?.signedDocumentSource === "signara" ? (filing?.signedDocumentId ?? "") : "",
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement | null;

    setBusy(true);
    setError(null);
    setMessage(null);

    const body = new FormData();
    body.append("designeeName", designeeName);
    if (designeePhone) body.append("designeePhone", designeePhone);
    if (designeeFax) body.append("designeeFax", designeeFax);
    if (designeeAddress) body.append("designeeAddress", designeeAddress);
    // An uploaded file wins over a Signara id server-side, so both can be sent
    // without ambiguity: the file is the copy the operator just handed over.
    if (signaraDocumentId) body.append("signaraDocumentId", signaraDocumentId);
    if (fileInput?.files?.[0]) body.append("file", fileInput.files[0]);

    try {
      const res = await fetch(`/api/businesses/${businessId}/ein-filing`, {
        method: "POST",
        body,
      });
      const payload = (await res.json()) as { error?: string; filing?: EinFilingRecord };
      if (!res.ok) {
        setError(payload.error ?? "The authorization could not be recorded.");
        return;
      }
      setMessage(
        payload.filing?.signedDocumentId
          ? "Authorization recorded with the signed SS-4 on file. Run the EIN step to file it."
          : "Authorization recorded. Upload the signed SS-4 when it is ready, then run the EIN step.",
      );
      router.refresh();
    } catch {
      setError("The request could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-4 grid gap-3 border-t border-neutral-800 pt-4" onSubmit={submit}>
      <p className="text-xs uppercase tracking-wide text-neutral-400">
        EIN third-party designee authorization
      </p>

      {filing ? (
        <p className="text-xs text-neutral-400">
          Authorized {filing.authorizedAt.slice(0, 10)} by{" "}
          <span className="text-neutral-200">{filing.designeeName}</span>
          {filing.signedDocumentId
            ? ` · signed SS-4 via ${filing.signedDocumentSource ?? "upload"}`
            : " · signed SS-4 not on file"}
          {filing.faxId ? ` · faxed (${filing.faxId})` : ""}
          {filing.status ? ` · ${filing.status}` : ""}
        </p>
      ) : (
        <p className="text-xs text-neutral-500">
          The responsible party signs the SS-4 and names the firm filing for the business.
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-neutral-400">
          Designee name
          <input
            className="rounded-md border border-neutral-700 bg-black/30 px-3 py-2 text-sm text-neutral-100"
            onChange={(e) => setDesigneeName(e.target.value)}
            required
            value={designeeName}
          />
        </label>
        <label className="grid gap-1 text-xs text-neutral-400">
          Designee phone
          <input
            className="rounded-md border border-neutral-700 bg-black/30 px-3 py-2 text-sm text-neutral-100"
            onChange={(e) => setDesigneePhone(e.target.value)}
            value={designeePhone}
          />
        </label>
        <label className="grid gap-1 text-xs text-neutral-400">
          Designee fax
          <input
            className="rounded-md border border-neutral-700 bg-black/30 px-3 py-2 text-sm text-neutral-100"
            onChange={(e) => setDesigneeFax(e.target.value)}
            value={designeeFax}
          />
        </label>
        <label className="grid gap-1 text-xs text-neutral-400">
          Designee address
          <input
            className="rounded-md border border-neutral-700 bg-black/30 px-3 py-2 text-sm text-neutral-100"
            onChange={(e) => setDesigneeAddress(e.target.value)}
            value={designeeAddress}
          />
        </label>
      </div>

      <label className="grid gap-1 text-xs text-neutral-400">
        Signed Form SS-4 (PDF)
        <input
          accept="application/pdf,.pdf"
          className="text-xs text-neutral-400"
          name="file"
          type="file"
        />
      </label>

      <label className="grid gap-1 text-xs text-neutral-400">
        …or a Signara document id (Genesis downloads it at filing time)
        <input
          className="rounded-md border border-neutral-700 bg-black/30 px-3 py-2 text-sm text-neutral-100"
          onChange={(e) => setSignaraDocumentId(e.target.value)}
          placeholder="doc_…"
          value={signaraDocumentId}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button className="g-btn g-btn-primary" disabled={busy} type="submit">
          {busy ? "Recording…" : filing ? "Update authorization" : "Record authorization"}
        </button>
        <span className="text-xs text-neutral-500">
          Genesis files only the signed copy — it never signs for the applicant.
        </span>
      </div>

      {message ? <p className="text-xs text-emerald-300">{message}</p> : null}
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
    </form>
  );
}
