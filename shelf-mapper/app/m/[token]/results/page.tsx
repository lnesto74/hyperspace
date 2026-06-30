import { Suspense } from "react";
import { ResultsPageClient } from "./ResultsPageClient";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function ResultsPage({ params }: PageProps) {
  const { token } = await params;
  return (
    <Suspense fallback={<div className="p-8 text-center">…</div>}>
      <ResultsPageClient token={token} />
    </Suspense>
  );
}
