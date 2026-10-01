import type { Metadata } from "next";
import "./globals.css";

/**
 * Every route is server-rendered on demand. This is also the workaround for the
 * upstream Next.js 16 crash while statically generating the synthetic
 * `/_global-error` route (`Cannot read properties of null (reading 'useContext')`)
 * that the other Innotel platforms carry.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Genesis — BusinessOps",
  description:
    "Formation, filing preparation and registration orchestration. Genesis automates what the stack owns and hands the rest to the person who must attest to it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
