import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import biddiLogo from "@assets/biddiride-logo_1777062947639.png";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("admin@biddi.app");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await login(email, password);
    } catch (ex) {
      setErr("Invalid email or password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted px-4">
      <Card className="w-full max-w-md p-8 shadow-xl">
        <div className="flex flex-col items-center mb-8 gap-2">
          <img src={biddiLogo} alt="Biddi" className="h-14 w-auto" />
          <div className="text-xs uppercase tracking-widest text-accent font-semibold">Operations</div>
        </div>

        <form onSubmit={onSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              data-testid="input-email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              data-testid="input-password"
            />
          </div>
          {err && (
            <div className="text-sm text-destructive font-medium" data-testid="text-error">
              {err}
            </div>
          )}
          <Button type="submit" className="w-full" disabled={busy} data-testid="button-signin">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground mt-6 text-center">
          Default credentials: admin@biddi.app / biddi-admin
        </p>
      </Card>
    </div>
  );
}
