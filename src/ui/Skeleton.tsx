import React from "react";

export function SkeletonLine({ className = "" }: { className?: string }) {
  return (
    <div
      className={`h-3 w-full animate-pulse rounded bg-gray-200 ${className}`}
    />
  );
}

export function SkeletonBlock({ lines = 3 }: { lines?: number }) {
  return (
    <div
      className="space-y-2"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} />
      ))}
    </div>
  );
}
