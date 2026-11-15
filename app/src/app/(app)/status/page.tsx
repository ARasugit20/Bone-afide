import type { Metadata } from "next";
import { SystemStatus } from "@/components/SystemStatus";
import { PageHeader } from "@/components/ui";

// Internal page for the team. Not linked from the app.
export const metadata: Metadata = { title: "Status", robots: { index: false } };

export default function StatusPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Service status" sub="Internal. Not linked from the app." />
      <SystemStatus />
    </div>
  );
}
