import { Button } from "@/components/ui/button";
import { Accent, GlowBlobs } from "./bits";
import { FadedPhoto, Hills } from "./decor";
import { APP_URL, IMAGES } from "./images";
import { Reveal, RevealItem } from "./motion";

export function ClosingCta() {
  return (
    <section aria-labelledby="cta-title" className="section-dark section-pad relative isolate overflow-hidden">
      <FadedPhoto src={IMAGES.parkPack} tone="bark" />
      <GlowBlobs />
      <Hills front="surface" />
      <Reveal className="container-page relative text-center">
        <RevealItem>
          <h2 id="cta-title" className="mx-auto max-w-[48rem] text-display text-on-dark">
            See Bone-a-find <Accent tone="tennis">in action.</Accent>
          </h2>
          <p className="mx-auto mt-6 max-w-[34rem] text-lead text-on-dark/75">
            Replacing labels with evidence, so shelter teams can understand change over time and
            make more informed placement decisions.
          </p>
        </RevealItem>
        <RevealItem className="mt-10">
          <Button asChild variant="brand" size="pill">
            <a href={APP_URL}>Open the app</a>
          </Button>
        </RevealItem>
      </Reveal>
    </section>
  );
}
