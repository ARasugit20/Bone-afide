import { APP_URL } from "./images";

const PRODUCT = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#proof", label: "Proof" },
  { href: "#label-proof", label: "The label test" },
  { href: "#passport", label: "Behavior passport" },
];

export function Footer() {
  return (
    <footer className="relative border-t border-line bg-surface">
      <div className="container-page py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <p className="flex items-center gap-2 font-display text-h3 font-semibold text-ink">
              <img src="/logo.png" alt="" width={28} height={28} className="size-7 rounded-full" />
              Bone-a-find
            </p>
            <p className="mt-4 max-w-[26rem] text-body text-muted-ink">
              Behavior intelligence for animal shelters. Replacing labels with evidence.
            </p>
          </div>

          <nav aria-label="Product" className="text-body">
            <h2 className="font-semibold text-ink">Product</h2>
            <ul className="mt-4 space-y-2.5">
              {PRODUCT.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="text-muted-ink transition-colors duration-200 ease-ui hover:text-forest">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Get started" className="text-body">
            <h2 className="font-semibold text-ink">Get started</h2>
            <ul className="mt-4 space-y-2.5">
              <li>
                <a href={APP_URL} className="text-muted-ink transition-colors duration-200 ease-ui hover:text-forest">
                  Open the app
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 text-body text-muted-ink md:flex-row md:items-center md:justify-between">
          <p>© 2026 Bone-a-find</p>
          <p className="max-w-[34rem]">
            Decision support, not a diagnosis. Staff and a vet make the final call.
          </p>
        </div>
      </div>
    </footer>
  );
}
