"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

import { naukriLogin, naukriLoginStatus, naukriUseToken } from "./actions";

type Step =
  | { status: "checking" }
  | { status: "in"; since: string | null }
  | { status: "out"; message?: string }
  /** The sign-in failed: Naukri may want a CAPTCHA, which only a browser can answer. */
  | { status: "token"; message?: string }
  | { status: "busy"; from: "out" | "token"; message?: string };

type Answer = Awaited<ReturnType<typeof naukriLoginStatus>>;

/**
 * Whether NopeRi is signed in to Naukri, in Settings → Job search and on
 * Recommended. Signed out, it offers to sign in; when that fails, to use the
 * nauk_at token from a browser that's signed in.
 */
export function NaukriLogin({ onLoggedIn, className }: { onLoggedIn?: () => void; className?: string }) {
  const [step, setStep] = useState<Step>({ status: "checking" });
  const [token, setToken] = useState("");

  const settle = (answer: Answer, failed: { status: "out" | "token"; message?: string }) => {
    if (answer.ok && answer.data.ok && answer.data.loggedIn) {
      setStep({ status: "in", since: answer.data.loginTime });
      onLoggedIn?.();
    } else {
      // A wrong address or key, or NopeRi not answering, says so; a missing sign-in gets this step's own words.
      const message = !answer.ok ? answer.error : answer.data.ok || answer.data.problem === "login" ? undefined : answer.data.message;
      setStep({ ...failed, message: message ?? failed.message });
    }
  };

  useEffect(() => {
    void naukriLoginStatus({}).then((answer) => settle(answer, { status: "out" }));
    // Checked once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logIn = async () => {
    setStep({ status: "busy", from: "out" });
    settle(await naukriLogin({}), { status: "token", message: "Naukri didn't let NopeRi sign in; it may want a CAPTCHA. Sign in on naukri.com in a browser and paste its token instead." });
  };

  const submitToken = async () => {
    setStep({ status: "busy", from: "token" });
    settle(await naukriUseToken({ token }), { status: "token", message: "That token didn't work. Copy it again from a browser that's signed in to naukri.com." });
  };

  if (step.status === "checking") return <p className={cn("text-meta text-muted", className)}>Checking the Naukri sign-in…</p>;
  if (step.status === "in") {
    return (
      <p role="status" className={cn("flex items-center gap-2 text-control text-success", className)}>
        <span aria-hidden className="size-2 flex-none rounded-full bg-success" />
        Signed in to Naukri{step.since ? ` since ${new Date(step.since).toLocaleString()}` : ""}
      </p>
    );
  }

  const busy = step.status === "busy";
  const asking = step.status === "token" || (busy && step.from === "token");
  const message = step.status === "busy" ? undefined : step.message;
  return (
    <div role="note" className={cn("flex flex-col gap-3 rounded-card bg-warning-surface px-4 py-3 text-meta text-warning", className)}>
      <p>{message ?? "NopeRi isn't signed in to Naukri. Recommended jobs and whole postings need it; searching doesn't."}</p>
      {asking ? (
        <div className="flex flex-col gap-2.5">
          <Input
            label="Naukri token"
            type="password"
            autoComplete="off"
            value={token}
            hint="On naukri.com, signed in: DevTools → Application → Cookies → copy the value of nauk_at."
            onChange={(event) => setToken(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void submitToken()} disabled={busy || token.trim().length < 20}>
              {busy ? "Checking…" : "Use token"}
            </Button>
            <Button size="sm" variant="text" onClick={() => void logIn()} disabled={busy}>
              Try signing in again
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" className="self-start" onClick={() => void logIn()} disabled={busy}>
          {busy ? "Signing in…" : "Log in to Naukri"}
        </Button>
      )}
    </div>
  );
}
