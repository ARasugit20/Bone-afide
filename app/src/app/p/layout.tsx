// Public QR passport: no nav, no role switcher. Mobile first.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-12 pt-6 sm:px-6 sm:pt-10">{children}</main>;
}
