"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { AccountDot } from "@/components/account-dot";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AccountPublic } from "@/lib/types";

export type CalendarView = "month" | "week" | "agenda";

interface CalendarToolbarProps {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  /** Human-readable label for the visible period (e.g. "June 2026"). */
  periodLabel: string;
  onPrev: () => void;
  onToday: () => void;
  onNext: () => void;
  accounts: AccountPublic[];
  selectedAccountId: string; // "all" | account id
  onAccountChange: (id: string) => void;
  onNewEvent: () => void;
  /** Disable "New event" when there are no accounts to organise from. */
  canCreate: boolean;
}

export function CalendarToolbar({
  view,
  onViewChange,
  periodLabel,
  onPrev,
  onToday,
  onNext,
  accounts,
  selectedAccountId,
  onAccountChange,
  onNewEvent,
  canCreate,
}: CalendarToolbarProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      {/* Left: navigation + period */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onToday}
          className="h-8"
        >
          Today
        </Button>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onPrev}
            aria-label="Previous period"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onNext}
            aria-label="Next period"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <h1 className="ml-1 truncate text-base font-semibold tracking-tight sm:text-lg" title={periodLabel}>
          {periodLabel}
        </h1>
      </div>

      {/* Right: filter + view + new */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={selectedAccountId} onValueChange={onAccountChange}>
          <SelectTrigger
            className="h-8 w-[170px] sm:w-[200px]"
            aria-label="Filter by account"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All accounts</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                <span className="flex items-center gap-2">
                  <AccountDot color={a.color} size="sm" />
                  <span className="truncate">{a.email}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tabs
          value={view}
          onValueChange={(v) => onViewChange(v as CalendarView)}
        >
          <TabsList className="h-8">
            <TabsTrigger value="month" className="h-7 px-2.5 text-xs sm:px-3 sm:text-sm">
              Month
            </TabsTrigger>
            <TabsTrigger value="week" className="h-7 px-2.5 text-xs sm:px-3 sm:text-sm">
              Week
            </TabsTrigger>
            <TabsTrigger value="agenda" className="h-7 px-2.5 text-xs sm:px-3 sm:text-sm">
              Agenda
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Button
          size="sm"
          className="h-8"
          onClick={onNewEvent}
          disabled={!canCreate}
          title={canCreate ? undefined : "Connect an account to create events"}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">New event</span>
        </Button>
      </div>
    </div>
  );
}
