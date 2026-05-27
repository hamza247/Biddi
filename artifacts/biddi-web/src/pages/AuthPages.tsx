import { useState } from "react";
import { Link } from "wouter";
import { api, ApiError, setToken } from "@/lib/api";
import { useSite } from "@/lib/site-context";
import { tr } from "@/lib/i18n";
import { useSeo } from "@/lib/seo";

function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="container-page py-16 md:py-24 max-w-md">
      <div className="card-soft">
        <h1 className="font-display text-2xl font-bold mb-1">{title}</h1>
        {subtitle && <p className="text-muted-foreground text-sm mb-6">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

function errMessage(e: unknown, fallback: string, T: ReturnType<typeof tr>): string {
  if (e instanceof ApiError) {
    const code = (e.payload as { error?: string } | null)?.error;
    if (code === "too_many_requests" || code === "too_many_attempts") return T.auth.tooManyAttempts;
    if (code === "invalid_or_expired_code") return T.auth.invalidOrExpiredCode;
    if (code === "invalid_phone") return T.auth.invalidPhone;
    if (code === "invalid_email") return T.auth.invalidEmail;
    if (code === "email_taken") return T.auth.emailAlreadyInUse;
    if (code === "weak_password") return T.auth.passwordTooWeak;
    if (code === "bad_credentials") return T.auth.badCredentials;
    return code || fallback;
  }
  return fallback;
}

export function SignInPage() {
  const { lang, settings } = useSite();
  const T = tr(lang);
  useSeo({ settings, fallbackTitle: T.auth.signin + " — BiddiRides" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setErr(T.auth.invalid); return; }
    if (password.length < 1) { setErr(T.auth.invalid); return; }
    setLoading(true);
    try {
      const res = await api<{ token: string }>("/auth/login", { method: "POST", json: { email, password } });
      setToken(res.token);
      window.location.href = `/${lang}/`;
    } catch (e) {
      setErr(errMessage(e, T.auth.invalid, T));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard title={T.auth.signin} subtitle={T.auth.welcomeBack}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label-field">{T.auth.email}</label>
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-field" />
        </div>
        <div>
          <label className="label-field">{T.auth.password}</label>
          <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input-field" />
        </div>
        {err && <div className="text-sm text-destructive" role="alert">{err}</div>}
        <button disabled={loading} className="btn-primary w-full">{loading ? "…" : T.auth.signin}</button>
        <div className="text-sm text-muted-foreground flex justify-between">
          <Link href={`/${lang}/forgot-password`} className="hover:text-foreground">{T.auth.forgot}</Link>
          <Link href={`/${lang}/signup`} className="hover:text-foreground">{T.auth.noAccount} {T.auth.signup}</Link>
        </div>
      </form>
    </AuthCard>
  );
}

export function SignUpPage() {
  const { lang, settings } = useSite();
  const T = tr(lang);
  useSeo({ settings, fallbackTitle: T.auth.signup + " — BiddiRides" });

  const [step, setStep] = useState<"phone" | "code" | "profile">("phone");
  const [phone, setPhone] = useState("");
  const [firstName, setFirstName] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setLocalToken] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isPhoneValid = (p: string) => /^\+?\d[\d\s\-()]{6,}$/.test(p.trim());

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setInfo(null);
    if (!isPhoneValid(phone)) { setErr(T.auth.enterValidPhone); return; }
    if (firstName.trim().length < 1) { setErr(T.auth.enterFirstName); return; }
    setLoading(true);
    try {
      await api("/auth/request-otp", { method: "POST", json: { phone } });
      setInfo(T.auth.codeSent);
      setStep("code");
    } catch (e) {
      setErr(errMessage(e, T.auth.couldNotSendCode, T));
    } finally { setLoading(false); }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!/^\d{4,8}$/.test(code)) { setErr(T.auth.enterCode); return; }
    setLoading(true);
    try {
      const res = await api<{ token: string; needsProfileCompletion?: boolean }>("/auth/verify-otp", {
        method: "POST", json: { phone, code, firstName },
      });
      setLocalToken(res.token);
      setToken(res.token);
      if (res.needsProfileCompletion) setStep("profile");
      else window.location.href = `/${lang}/`;
    } catch (e) {
      setErr(errMessage(e, T.auth.invalidOrExpiredCode, T));
    } finally { setLoading(false); }
  };

  const completeProfile = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setErr(T.auth.enterValidEmail); return; }
    if (password.length < 8) { setErr(T.auth.passwordMin8); return; }
    if (!token) { setErr(T.auth.sessionExpired); setStep("phone"); return; }
    setLoading(true);
    try {
      await api("/auth/complete-profile", { method: "POST", json: { firstName, email, password } });
      window.location.href = `/${lang}/`;
    } catch (e) {
      setErr(errMessage(e, T.auth.couldNotComplete, T));
    } finally { setLoading(false); }
  };

  return (
    <AuthCard title={T.auth.signup} subtitle={T.auth.signupSubtitle}>
      {step === "phone" && (
        <form onSubmit={requestCode} className="space-y-4">
          <div>
            <label className="label-field">{T.auth.firstName}</label>
            <input required value={firstName} onChange={(e) => setFirstName(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="label-field">{T.auth.phone}</label>
            <input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 123 4567" className="input-field" />
          </div>
          {err && <div className="text-sm text-destructive" role="alert">{err}</div>}
          <button disabled={loading} className="btn-primary w-full">{loading ? "…" : T.auth.sendCode}</button>
        </form>
      )}
      {step === "code" && (
        <form onSubmit={verifyCode} className="space-y-4">
          {info && <div className="text-sm text-muted-foreground">{info}</div>}
          <div>
            <label className="label-field">{T.auth.verificationCode}</label>
            <input required inputMode="numeric" pattern="\d*" value={code} onChange={(e) => setCode(e.target.value)} className="input-field tracking-widest text-center" />
          </div>
          {err && <div className="text-sm text-destructive" role="alert">{err}</div>}
          <button disabled={loading} className="btn-primary w-full">{loading ? "…" : T.auth.verify}</button>
          <button type="button" onClick={() => setStep("phone")} className="text-sm text-muted-foreground hover:text-foreground">
            {T.auth.useDifferentPhone}
          </button>
        </form>
      )}
      {step === "profile" && (
        <form onSubmit={completeProfile} className="space-y-4">
          <p className="text-sm text-muted-foreground">{T.auth.almostDone}</p>
          <div>
            <label className="label-field">{T.auth.email}</label>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="label-field">{T.auth.password}</label>
            <input required type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="input-field" />
          </div>
          {err && <div className="text-sm text-destructive" role="alert">{err}</div>}
          <button disabled={loading} className="btn-primary w-full">{loading ? "…" : T.auth.createAccount}</button>
        </form>
      )}
      <div className="text-sm text-muted-foreground mt-6 text-center">
        {T.auth.hasAccount} <Link href={`/${lang}/signin`} className="text-primary hover:underline">{T.auth.signin}</Link>
      </div>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const { lang, settings } = useSite();
  const T = tr(lang);
  useSeo({ settings, fallbackTitle: T.auth.forgot + " — BiddiRides" });

  // Two-step web reset:
  //   step="phone": collect phone, call /auth/request-otp.
  //   step="verify": collect SMS code + new password, call /auth/reset-password.
  // On success the server returns a token that signs the user in immediately.
  type Step = "phone" | "verify" | "done";
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onRequest = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (phone.replace(/\D/g, "").length < 7) {
      setErr(T.auth.enterPhoneNumber);
      return;
    }
    setLoading(true);
    try {
      await api("/auth/request-otp", { method: "POST", json: { phone } });
      setStep("verify");
    } catch (e) {
      setErr(errMessage(e, T.auth.couldNotSendCode, T));
    } finally { setLoading(false); }
  };

  const onReset = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!/^\d{4,8}$/.test(code)) {
      setErr(T.auth.enterSmsCode);
      return;
    }
    if (password.length < 8) {
      setErr(T.auth.passwordMin8);
      return;
    }
    setLoading(true);
    try {
      const res = await api<{ token: string }>("/auth/reset-password", {
        method: "POST",
        json: { phone, code, password },
      });
      setToken(res.token);
      setStep("done");
    } catch (e) {
      setErr(errMessage(e, T.auth.couldNotReset, T));
    } finally { setLoading(false); }
  };

  if (step === "done") {
    return (
      <AuthCard title={T.auth.passwordUpdated} subtitle={T.auth.signedIn}>
        <a href={`/${lang}/`} className="btn-primary w-full inline-block text-center">
          {T.auth.continueAction}
        </a>
      </AuthCard>
    );
  }

  if (step === "verify") {
    return (
      <AuthCard title={T.auth.forgot} subtitle={T.auth.forgotVerifyIntro}>
        <form onSubmit={onReset} className="space-y-4">
          <div>
            <label className="label-field">{T.auth.smsCode}</label>
            <input required inputMode="numeric" pattern="\d*" value={code} onChange={(e) => setCode(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="label-field">{T.auth.newPassword}</label>
            <input required type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="input-field" />
          </div>
          {err && <div className="text-sm text-destructive" role="alert">{err}</div>}
          <button disabled={loading} className="btn-primary w-full">{loading ? "…" : T.auth.resetPassword}</button>
          <button type="button" onClick={() => { setStep("phone"); setCode(""); setPassword(""); }} className="text-sm text-muted-foreground hover:text-foreground w-full">
            {T.auth.useDifferentNumber}
          </button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={T.auth.forgot} subtitle={T.auth.forgotIntro}>
      <form onSubmit={onRequest} className="space-y-4">
        <div>
          <label className="label-field">{T.auth.phone}</label>
          <input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="input-field" placeholder="+1 555 123 4567" />
        </div>
        {err && <div className="text-sm text-destructive" role="alert">{err}</div>}
        <button disabled={loading} className="btn-primary w-full">{loading ? "…" : T.auth.sendCode}</button>
        <div className="text-sm text-muted-foreground mt-2 text-center">
          <Link href={`/${lang}/signin`} className="hover:text-foreground">{T.auth.signin}</Link>
        </div>
      </form>
    </AuthCard>
  );
}
