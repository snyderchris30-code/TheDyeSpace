"use client";

import { useEffect } from "react";
import AsyncStateCard from "@/app/AsyncStateCard";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <AsyncStateCard
          tone="error"
          title="Couldn\'t finish loading this page"
          message="Something failed while rendering the page. Please try again, and if it keeps happening, refresh the site once more."
          actionLabel="Try again"
          onAction={reset}
        />
      </div>
    </div>
  );
}