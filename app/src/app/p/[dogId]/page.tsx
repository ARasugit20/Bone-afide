import type { Metadata } from "next";
import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { PublicPassportView } from "./PublicPassportView";

export const metadata: Metadata = { title: "Behavior passport", description: "Behavior measured on kennel video. Breed is never recorded." };

export default function PublicPassportPage() {
  return (
    <Suspense fallback={<Spinner label="Loading passport" />}>
      <PublicPassportView />
    </Suspense>
  );
}
