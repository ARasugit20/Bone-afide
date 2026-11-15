"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** Large QR code for the public passport, sized to scan from a projector or a printed sheet. */
export function PassportQr({ dogId, name }: { dogId: string; name: string }) {
  const [svg, setSvg] = useState("");
  const [url, setUrl] = useState("");

  useEffect(() => {
    // NEXT_PUBLIC_SITE_URL points at the live site so codes scanned from a laptop demo still open the deployed page.
    const base = (process.env.NEXT_PUBLIC_SITE_URL || window.location.origin).replace(/\/$/, "");
    const link = `${base}/p/${encodeURIComponent(dogId)}`;
    let live = true;
    QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#18241d", light: "#ffffff" } }).then((s) => {
      if (live) {
        setSvg(s);
        setUrl(link);
      }
    });
    return () => {
      live = false;
    };
  }, [dogId]);

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <div
        role="img"
        aria-label={`QR code for ${name}'s public passport`}
        className="aspect-square w-64 max-w-full shrink-0 rounded-xl bg-white p-2 ring-1 ring-line sm:w-72 [&>svg]:h-full [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="min-w-0 text-center sm:text-left">
        <p className="font-semibold">Scan for {name}&apos;s public passport</p>
        <p className="mt-1 text-sm text-muted">For landlords and adopters. Shows behavior, video and rentals. No staff notes.</p>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-block break-all text-sm font-semibold text-forest hover:underline">
            {url.replace(/^https?:\/\//, "")}
          </a>
        )}
      </div>
    </div>
  );
}
