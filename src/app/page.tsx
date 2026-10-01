import Link from "next/link";
import * as store from "@/lib/store";
import { currentClient, signInHint } from "@/lib/guard";
import { isAdmin } from "@/lib/session";
import { planSteps, progress } from "@/lib/workflow/engine";
import { STEP_CATALOG, PHASES } from "@/lib/workflow/catalog";

export const dynamic = "force-dynamic";

function SignIn() {
  const hint = signInHint();
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <p className="mb-3 text-xs uppercase tracking-[0.12em] text-teal-300">
        BusinessOps · self-hosted
      </p>
      <h1 className="mb-4 text-4xl font-bold tracking-tight">
        Genesis<span className="text-teal-400">.</span>
      </h1>
      <p className="mb-8 text-neutral-300">
        Genesis takes a business from an idea to a registered, reachable, bankable entity. It
        automates the parts this stack owns — the telephone number, the domain, the mail, billing —
        and prepares, but never impersonates, everything that needs the owner&apos;s signature.
      </p>
      <a className="g-btn g-btn-primary" href="/api/auth/login">
        Sign in
      </a>
      <p className="mt-4 text-sm text-neutral-500">
        {hint.oidc
          ? "You will be redirected to Cerulean Authentik."
          : hint.dev
            ? "OIDC is not configured — GENESIS_DEV_AUTH is on, so sign-in uses the local demo identity."
            : "Sign-in is not configured yet: set OIDC_* and restart."}
      </p>
    </main>
  );
}

export default async function Dashboard() {
  const session = await currentClient();
  if (!session) return <SignIn />;

  const businesses = isAdmin(session.user)
    ? store.listBusinesses()
    : store.listBusinesses(session.client.id);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.12em] text-teal-300">
            Genesis · BusinessOps
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Businesses</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {session.user.email}
            {isAdmin(session.user) ? " · operator" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Link className="g-btn g-btn-secondary" href="/policy">
            Policy
          </Link>
          <Link className="g-btn g-btn-primary" href="/businesses/new">
            New business
          </Link>
        </div>
      </header>

      {businesses.length === 0 ? (
        <div className="g-card text-neutral-300">
          <p className="mb-2 font-medium text-neutral-100">No businesses yet.</p>
          <p className="text-sm">
            Start with intake: {STEP_CATALOG.length} tracked steps across {PHASES.length} phases,
            from the operating address to the credit bureaus.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {businesses.map((business) => {
            const p = progress(planSteps(business, store.listPersistedSteps(business.id)));
            return (
              <li key={business.id}>
                <Link className="g-card block hover:border-teal-500" href={`/businesses/${business.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">
                        {business.legalName}
                        {business.dba ? (
                          <span className="ml-2 text-sm font-normal text-neutral-400">
                            dba {business.dba}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-wide text-neutral-500">
                        {business.entityType} · {business.formationState}
                        {business.ein ? ` · EIN ${business.ein}` : " · EIN pending"}
                      </p>
                    </div>
                    <div className="min-w-[180px]">
                      <div className="mb-1 flex justify-between text-xs text-neutral-400">
                        <span>
                          {p.complete}/{p.total} steps
                        </span>
                        <span>{p.percent}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
                        <div
                          className="h-full rounded-full bg-teal-500"
                          style={{ width: `${p.percent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <footer className="mt-12 border-t border-neutral-800 pt-4 text-xs text-neutral-500">
        <div className="flex flex-wrap gap-4">
          <span>Genesis — BusinessOps</span>
          <a className="hover:text-neutral-300" href="/api/health">
            health
          </a>
          <a className="hover:text-neutral-300" href="/api/auth/logout">
            sign out
          </a>
        </div>
      </footer>
    </main>
  );
}
