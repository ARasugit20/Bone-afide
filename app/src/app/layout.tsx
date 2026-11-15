import type { Metadata } from "next";
import { Fraunces, Nunito } from "next/font/google";
import { AuthProvider } from "@/components/AuthProvider";
import { Nav } from "@/components/Nav";
import "./globals.css";

const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"] });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Bonafide — judge the dog, not the label",
  description: "Breed-blind shelter matching from real behavior. Decision support, not a diagnosis.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${nunito.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <AuthProvider>
          <Nav />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-6 sm:px-6 print:max-w-none print:p-0">{children}</main>
        </AuthProvider>
        <footer className="py-6 text-center text-xs text-muted print:hidden">
          Bonafide · breed is never stored or shown · Decision support, not a diagnosis.
        </footer>
      </body>
    </html>
  );
}
