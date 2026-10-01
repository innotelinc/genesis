"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const ENTITY_TYPES = [
  { value: "llc", label: "LLC" },
  { value: "s_corp", label: "S corporation" },
  { value: "c_corp", label: "C corporation" },
  { value: "sole_prop", label: "Sole proprietor" },
  { value: "nonprofit", label: "Nonprofit" },
];

const ADDRESS_SOURCES = [
  { value: "owned", label: "Owned premises" },
  { value: "home", label: "Home / sole office" },
  { value: "registered_agent", label: "Registered agent" },
  { value: "virtual_office", label: "Virtual office" },
];

export default function IntakePage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);

  const [form, setForm] = useState({
    legalName: "",
    dba: "",
    entityType: "llc",
    formationState: "",
    formationDate: "",
    industry: "",
    websiteDomain: "",
    phoneAreaCode: "",
    source: "owned",
    line1: "",
    line2: "",
    city: "",
    state: "",
    postal: "",
    sameMailing: true,
    mLine1: "",
    mCity: "",
    mState: "",
    mPostal: "",
    fullName: "",
    role: "Member",
    email: "",
    phone: "",
    ssnLast4: "",
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setIssues([]);

    const principal = {
      kind: "principal",
      source: form.source,
      line1: form.line1,
      line2: form.line2 || undefined,
      city: form.city,
      state: form.state.toUpperCase(),
      postal: form.postal,
      country: "US",
    };

    const addresses: Array<{
      kind: string;
      source: string;
      line1: string;
      line2?: string;
      city: string;
      state: string;
      postal: string;
      country: string;
    }> = [principal];

    if (!form.sameMailing) {
      addresses.push({
        kind: "mailing",
        source: "owned",
        line1: form.mLine1,
        city: form.mCity,
        state: form.mState.toUpperCase(),
        postal: form.mPostal,
        country: "US",
      });
    }

    const payload = {
      legalName: form.legalName,
      dba: form.dba || undefined,
      entityType: form.entityType,
      formationState: form.formationState.toUpperCase(),
      formationDate: form.formationDate || undefined,
      industry: form.industry || undefined,
      websiteDomain: form.websiteDomain || undefined,
      phoneAreaCode: form.phoneAreaCode || undefined,
      addresses,
      people: [
        {
          fullName: form.fullName,
          role: form.role,
          email: form.email,
          phone: form.phone || undefined,
          ssnLast4: form.ssnLast4 || undefined,
        },
      ],
    };

    try {
      const res = await fetch("/api/businesses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as {
        business?: { id: string };
        error?: string;
        issues?: { path: string; message: string }[];
      };

      if (!res.ok || !body.business) {
        setIssues(
          body.issues?.map((i) => `${i.path || "form"}: ${i.message}`) ?? [
            body.error ?? "Intake could not be saved.",
          ],
        );
        return;
      }
      router.push(`/businesses/${body.business.id}`);
    } catch {
      setIssues(["Intake could not be saved."]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link className="text-sm text-teal-300 hover:text-teal-200" href="/">
        ← Businesses
      </Link>
      <h1 className="mt-4 mb-2 text-3xl font-bold tracking-tight">New business</h1>
      <p className="mb-8 max-w-2xl text-sm text-neutral-400">
        The operating address is checked before anything else: a domain, a PO box or an agent
        address cannot stand in for it on a filing.
      </p>

      {issues.length > 0 ? (
        <ul className="mb-6 rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}

      <form className="grid gap-6" onSubmit={submit}>
        <fieldset className="g-card">
          <legend className="mb-4 text-sm uppercase tracking-wide text-neutral-400">Entity</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="g-label">Legal name *</span>
              <input
                className="g-input"
                onChange={(e) => set("legalName", e.target.value)}
                required
                value={form.legalName}
              />
            </label>
            <label>
              <span className="g-label">Trade name (dba)</span>
              <input className="g-input" onChange={(e) => set("dba", e.target.value)} value={form.dba} />
            </label>
            <label>
              <span className="g-label">Entity type *</span>
              <select
                className="g-input"
                onChange={(e) => set("entityType", e.target.value)}
                value={form.entityType}
              >
                {ENTITY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="g-label">Formation state *</span>
              <input
                className="g-input"
                maxLength={2}
                onChange={(e) => set("formationState", e.target.value)}
                placeholder="DE"
                required
                value={form.formationState}
              />
            </label>
            <label>
              <span className="g-label">Formation date</span>
              <input
                className="g-input"
                onChange={(e) => set("formationDate", e.target.value)}
                placeholder="2026-09-29"
                value={form.formationDate}
              />
            </label>
            <label>
              <span className="g-label">Industry</span>
              <input
                className="g-input"
                onChange={(e) => set("industry", e.target.value)}
                placeholder="Software development"
                value={form.industry}
              />
            </label>
            <label>
              <span className="g-label">Domain you want</span>
              <input
                className="g-input"
                onChange={(e) => set("websiteDomain", e.target.value)}
                placeholder="acme.com"
                value={form.websiteDomain}
              />
            </label>
            <label>
              <span className="g-label">Number area code</span>
              <input
                className="g-input"
                maxLength={3}
                onChange={(e) => set("phoneAreaCode", e.target.value)}
                placeholder="415"
                value={form.phoneAreaCode}
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="g-card">
          <legend className="mb-4 text-sm uppercase tracking-wide text-neutral-400">
            Principal place of business
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="g-label">Street address *</span>
              <input
                className="g-input"
                onChange={(e) => set("line1", e.target.value)}
                placeholder="123 Main St"
                required
                value={form.line1}
              />
            </label>
            <label className="sm:col-span-2">
              <span className="g-label">Suite / unit</span>
              <input className="g-input" onChange={(e) => set("line2", e.target.value)} value={form.line2} />
            </label>
            <label>
              <span className="g-label">City *</span>
              <input
                className="g-input"
                onChange={(e) => set("city", e.target.value)}
                required
                value={form.city}
              />
            </label>
            <label>
              <span className="g-label">State *</span>
              <input
                className="g-input"
                maxLength={2}
                onChange={(e) => set("state", e.target.value)}
                placeholder="CA"
                required
                value={form.state}
              />
            </label>
            <label>
              <span className="g-label">ZIP *</span>
              <input
                className="g-input"
                onChange={(e) => set("postal", e.target.value)}
                placeholder="94105"
                required
                value={form.postal}
              />
            </label>
            <label>
              <span className="g-label">Where is this address from? *</span>
              <select
                className="g-input"
                onChange={(e) => set("source", e.target.value)}
                value={form.source}
              >
                {ADDRESS_SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-neutral-300">
            <input
              checked={form.sameMailing}
              onChange={(e) => set("sameMailing", e.target.checked)}
              type="checkbox"
            />
            Mail goes to the same address
          </label>
          {!form.sameMailing ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="g-label">Mailing street</span>
                <input className="g-input" onChange={(e) => set("mLine1", e.target.value)} value={form.mLine1} />
              </label>
              <label>
                <span className="g-label">City</span>
                <input className="g-input" onChange={(e) => set("mCity", e.target.value)} value={form.mCity} />
              </label>
              <label>
                <span className="g-label">State</span>
                <input
                  className="g-input"
                  maxLength={2}
                  onChange={(e) => set("mState", e.target.value)}
                  value={form.mState}
                />
              </label>
              <label>
                <span className="g-label">ZIP</span>
                <input className="g-input" onChange={(e) => set("mPostal", e.target.value)} value={form.mPostal} />
              </label>
            </div>
          ) : null}
        </fieldset>

        <fieldset className="g-card">
          <legend className="mb-4 text-sm uppercase tracking-wide text-neutral-400">
            Responsible party
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="g-label">Full name *</span>
              <input
                className="g-input"
                onChange={(e) => set("fullName", e.target.value)}
                required
                value={form.fullName}
              />
            </label>
            <label>
              <span className="g-label">Role *</span>
              <input
                className="g-input"
                onChange={(e) => set("role", e.target.value)}
                value={form.role}
              />
            </label>
            <label>
              <span className="g-label">Email *</span>
              <input
                className="g-input"
                onChange={(e) => set("email", e.target.value)}
                required
                type="email"
                value={form.email}
              />
            </label>
            <label>
              <span className="g-label">Phone</span>
              <input className="g-input" onChange={(e) => set("phone", e.target.value)} value={form.phone} />
            </label>
            <label>
              <span className="g-label">SSN last four</span>
              <input
                className="g-input"
                maxLength={4}
                onChange={(e) => set("ssnLast4", e.target.value)}
                placeholder="1234"
                value={form.ssnLast4}
              />
            </label>
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            Genesis stores only the last four digits. The full SSN/ITIN is entered on the SS-4 by
            the responsible party.
          </p>
        </fieldset>

        <div>
          <button className="g-btn g-btn-primary" disabled={busy} type="submit">
            {busy ? "Saving…" : "Create business"}
          </button>
        </div>
      </form>
    </main>
  );
}
