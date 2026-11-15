import type { Metadata } from "next";
import { Fraunces, Nunito } from "next/font/google";
import { AuthProvider } from "@/components/AuthProvider";
import "./globals.css";

const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"] });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Bonafide",
  description: "Shelter matching from behavior scored on kennel video. Breed is never an input.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-scroll-behavior: the Amplify UI stylesheet sets smooth scrolling on <html>; this tells Next to turn it off during route changes.
    <html lang="en" data-scroll-behavior="smooth" className={`${nunito.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
