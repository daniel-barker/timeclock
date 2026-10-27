"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function AuthControl({ action }: { action: "signin" | "signout" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleClick() {
    setError("");
    setPending(true);
    try {
      if (action === "signin") {
        const result = await authClient.signIn.social({
          provider: "google", callbackURL: "/", errorCallbackURL: "/login?error=signin",
        });
        if (result.error) throw new Error("Sign-in failed");
      } else {
        const result = await authClient.signOut();
        if (result.error) throw new Error("Sign-out failed");
        router.replace("/login");
        router.refresh();
      }
    } catch {
      setError(action === "signin" ? "Couldn’t start sign-in. Please try again." : "Couldn’t sign out. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button onClick={handleClick} disabled={pending} size="lg" variant={action === "signin" ? "default" : "outline"}>
        {pending ? "Please wait…" : action === "signin" ? "Continue with Google" : "Sign out"}
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
