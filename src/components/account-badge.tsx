import { AccountDot } from "@/components/account-dot";
import { cn } from "@/lib/utils";
import type { AccountPublic } from "@/lib/types";

export interface AccountBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  account: Pick<AccountPublic, "color" | "email" | "displayName">;
  /** Show the display name (when present) instead of the raw email. */
  preferName?: boolean;
  dotSize?: "sm" | "md" | "lg";
}

/**
 * A coloured account dot next to its email (or display name), truncated so it
 * never overflows its container. Used throughout lists, headers, and selectors.
 */
export function AccountBadge({
  account,
  preferName = false,
  dotSize = "md",
  className,
  ...props
}: AccountBadgeProps) {
  const label =
    preferName && account.displayName ? account.displayName : account.email;

  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-2", className)}
      {...props}
    >
      <AccountDot color={account.color} size={dotSize} />
      <span className="min-w-0 truncate text-sm" title={account.email}>
        {label}
      </span>
    </span>
  );
}
