import { Suspense } from "react";
import { Gate } from "@/components/AuthProvider";
import { Spinner } from "@/components/ui";
import { STAFF_ONLY } from "@/lib/access";
import { DogView } from "./DogView";

export default function DogPage() {
  return (
    <Suspense fallback={<Spinner label="Loading dog" />}>
      <Gate allow={STAFF_ONLY}>
        <DogView />
      </Gate>
    </Suspense>
  );
}
