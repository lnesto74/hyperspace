import { Suspense } from "react";
import { MapperPageClient } from "./MapperPageClient";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function MapperPage({ params }: PageProps) {
  const { token } = await params;
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center">…</div>}>
      <MapperPageClient token={token} />
    </Suspense>
  );
}
