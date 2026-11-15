import Link from "next/link";
import { AccountControl } from "@/components/AuthProvider";
import { Nav } from "@/components/Nav";

// Staff, vet and family app: nav and footer. The role switcher lives in the footer account area.
// The public QR passport (/p) has its own layout.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16 pt-6 sm:px-6 sm:pt-8 lg:px-8 print:max-w-none print:p-0">{children}</main>
      <footer className="print:hidden">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 border-b border-line/70 px-4 py-6 text-xs text-muted sm:flex-row sm:items-start sm:justify-between sm:px-6 lg:px-8">
          <p className="max-w-prose">Breed is never stored or shown. Decision support, not a diagnosis.</p>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <Link href="/how-it-works" className="font-semibold hover:text-forest">How it works</Link>
            <AccountControl />
          </div>
        </div>
      </footer>
    </>
  );
}
