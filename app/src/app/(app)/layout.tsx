import Link from "next/link";
import { Nav } from "@/components/Nav";

// Staff, vet and family app: nav, role switcher and footer. The public QR passport (/p) has its own layout.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16 pt-6 sm:px-6 sm:pt-8 lg:px-8 print:max-w-none print:p-0">{children}</main>
      <footer className="border-t border-line/70 print:hidden">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>Breed is never stored or shown. Decision support, not a diagnosis.</p>
          <Link href="/how-it-works" className="font-semibold hover:text-forest">How it works</Link>
        </div>
      </footer>
    </>
  );
}
