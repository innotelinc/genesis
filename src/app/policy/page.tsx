import Link from "next/link";
import { policySummary } from "@/lib/workflow/policy";
import { STEP_CATALOG } from "@/lib/workflow/catalog";

export const dynamic = "force-dynamic";

/**
 * The automation policy, rendered from the same source the executor enforces.
 * If this page and the runtime could disagree, the runtime would be the only
 * thing worth trusting — so both read `PROVIDER_POLICY`.
 */
export default function PolicyPage() {
  const rows = policySummary();
  const automated = rows.filter((r) => r.mode === "automated");
  const assisted = rows.filter((r) => r.mode === "assisted");
  const human = rows.filter((r) => r.mode === "human");
  const modeOf = new Map(rows.map((r) => [r.provider, r.mode]));

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link className="text-sm text-teal-300 hover:text-teal-200" href="/">
        ← Businesses
      </Link>
      <h1 className="mt-4 mb-3 text-3xl font-bold tracking-tight">Automation policy</h1>
      <p className="mb-8 max-w-3xl text-neutral-300">
        Genesis orchestrates a business launch. Orchestration is where a naive implementation does
        real harm, so the split between what Genesis may do and what a person must do is explicit,
        enforced in code, and shown here.
      </p>

      <section className="mb-10">
        <h2 className="mb-3 text-sm uppercase tracking-wide text-teal-300">
          Automated ({automated.length})
        </h2>
        <ul className="grid gap-2">
          {automated.map((row) => (
            <li key={row.provider} className="g-card">
              <p className="font-medium">{row.provider}</p>
              <p className="mt-1 text-sm text-neutral-400">{row.reason}</p>
            </li>
          ))}
        </ul>
      </section>

      {assisted.length > 0 ? (
        <section className="mb-10">
          <h2 className="mb-3 text-sm uppercase tracking-wide text-sky-300">
            Assisted ({assisted.length})
          </h2>
          <p className="mb-3 max-w-3xl text-sm text-neutral-400">
            Genesis reaches these institutions, but only through an act the responsible party
            performed first — a signature, an authorization. It transmits exactly what was signed
            and nothing reconstructed, and the check is enforced where the transmission happens.
          </p>
          <ul className="grid gap-2">
            {assisted.map((row) => (
              <li key={row.provider} className="g-card">
                <p className="font-medium">{row.provider}</p>
                <p className="mt-1 text-sm text-neutral-400">{row.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm uppercase tracking-wide text-amber-300">
          Human-attested ({human.length})
        </h2>
        <p className="mb-3 max-w-3xl text-sm text-neutral-400">
          Genesis prepares the form, the packet or the listing text and hands it to the person who
          must attest to it. The executor refuses to automate any provider in this list.
        </p>
        <ul className="grid gap-2">
          {human.map((row) => (
            <li key={row.provider} className="g-card">
              <p className="font-medium">{row.provider}</p>
              <p className="mt-1 text-sm text-neutral-400">{row.reason}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-sm uppercase tracking-wide text-neutral-400">
          Step-to-provider map ({STEP_CATALOG.length} steps)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="py-2 pr-4">Phase</th>
                <th className="py-2 pr-4">Step</th>
                <th className="py-2 pr-4">Provider</th>
                <th className="py-2">Mode</th>
              </tr>
            </thead>
            <tbody>
              {STEP_CATALOG.map((step) => (
                <tr key={step.key} className="border-t border-neutral-800">
                  <td className="py-2 pr-4 text-neutral-400">{step.phase}</td>
                  <td className="py-2 pr-4">{step.title}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-neutral-400">{step.provider}</td>
                  <td className="py-2">
                    <span
                      className={
                        modeOf.get(step.provider) === "human"
                          ? "text-amber-300"
                          : modeOf.get(step.provider) === "assisted"
                            ? "text-sky-300"
                            : "text-teal-300"
                      }
                    >
                      {modeOf.get(step.provider) ?? "automated"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
