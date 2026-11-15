import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { PassportView } from "./PassportView";

export default function PassportPage() {
  return (
    <Suspense fallback={<Spinner label="Opening the behavior passport…" />}>
      <PassportView />
    </Suspense>
  );
}
