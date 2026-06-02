"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

/**
 * App-wide client providers. Mounted once in the root layout so every screen
 * gets tooltips and toasts. Kept minimal — data fetching uses SWR's global
 * cache directly via the hooks, so no extra provider is required for it.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={200}>
      {children}
      <Toaster position="bottom-right" closeButton />
    </TooltipProvider>
  );
}
