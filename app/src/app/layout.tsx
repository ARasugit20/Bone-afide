import type { Metadata } from "next";
import { Fraunces, Nunito } from "next/font/google";
import { AuthProvider } from "@/components/AuthProvider";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import "./globals.css";

const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"] });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Bonafide",
  description: "Shelter matching from behavior scored on kennel video. Breed is never an input.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${nunito.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <AuthProvider>
          <Nav />
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16 pt-6 sm:px-6 sm:pt-8 lg:px-8 print:max-w-none print:p-0">{children}</main>
        </AuthProvider>
        <footer className="border-t border-line/70 print:hidden">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <p>Breed is never stored or shown. Decision support, not a diagnosis.</p>
            <Link href="/how-it-works" className="font-semibold hover:text-forest">How it works</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
