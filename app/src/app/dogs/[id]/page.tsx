import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { DogView } from "./DogView";

export default function DogPage() {
  return (
    <Suspense fallback={<Spinner label="Fetching this pup's profile…" />}>
      <DogView />
    </Suspense>
  );
}
