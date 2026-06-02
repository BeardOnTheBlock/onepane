"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Columns3 } from "lucide-react";
import { signIn } from "next-auth/react";

import { Button } from "@/components/ui/button";

/** A simple Google "G" wordmark so the button reads as a real Google sign-in. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className="h-4 w-4">
      <path
        fill="#4285F4"
        d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.4673-.806 5.9564-2.1818l-2.9087-2.2581c-.8059.54-1.8368.8595-3.0477.8595-2.344 0-4.3282-1.5831-5.036-3.7104H.9574v2.3318C2.4382 15.9832 5.4818 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71c-.18-.54-.2823-1.1168-.2823-1.71s.1023-1.17.2823-1.71V4.9582H.9573C.3477 6.1732 0 7.5477 0 9s.3477 2.8268.9573 4.0418L3.964 10.71z"
      />
      <path
        fill="#EA4335"
        d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.656 3.5795 9 3.5795z"
      />
    </svg>
  );
}

/** The sign-in button reads ?callbackUrl, so it must sit under a Suspense
 *  boundary (Next 15 bails out of static prerender for useSearchParams). */
function SignInButton() {
  const searchParams = useSearchParams();
  const [signingIn, setSigningIn] = React.useState(false);

  // Honour ?callbackUrl from the middleware redirect; default to the inbox.
  const callbackUrl = searchParams.get("callbackUrl") || "/inbox";

  function handleSignIn() {
    setSigningIn(true);
    // next-auth performs a full-page redirect, so no need to reset the flag.
    void signIn("google", { callbackUrl });
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={handleSignIn}
      disabled={signingIn}
    >
      <GoogleMark />
      {signingIn ? "Redirecting…" : "Continue with Google"}
    </Button>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        {/* Brand */}
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow">
            <Columns3 className="h-6 w-6" aria-hidden="true" />
          </span>
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">OnePane</h1>
            <p className="text-sm text-muted-foreground">
              All your inboxes and calendars in one pane.
            </p>
          </div>
        </div>

        {/* Sign-in card */}
        <div className="w-full rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-5 space-y-1 text-center">
            <h2 className="text-base font-semibold">Sign in to continue</h2>
            <p className="text-sm text-muted-foreground">
              Use your Google account to get started.
            </p>
          </div>

          <React.Suspense
            fallback={
              <Button type="button" variant="outline" className="w-full" disabled>
                <GoogleMark />
                Continue with Google
              </Button>
            }
          >
            <SignInButton />
          </React.Suspense>
        </div>

        <p className="max-w-xs text-center text-xs leading-relaxed text-muted-foreground">
          By continuing you agree to connect your email and calendar accounts to
          OnePane. You can disconnect them at any time in Settings.
        </p>
      </div>
    </div>
  );
}
