import { useState } from "react";
import { Mail, Phone, MapPin } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSite } from "@/lib/site-context";
import { tr } from "@/lib/i18n";
import { SitePage } from "./SitePage";

export function ContactPage() {
  const { lang, settings } = useSite();
  const T = tr(lang);
  const [form, setForm] = useState({ name: "", email: "", phone: "", subject: "", message: "" });
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const onChange = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setError(null);
    try {
      await api("/site/contact", { method: "POST", json: form });
      setStatus("success");
      setForm({ name: "", email: "", phone: "", subject: "", message: "" });
    } catch (err) {
      setStatus("error");
      setError(err instanceof ApiError ? err.message : T.contact.failed);
    }
  };

  return (
    <SitePage slug="contact">
      <section className="container-page pb-20 grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-1 space-y-4">
          <div className="card-soft">
            <div className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-primary/10 text-primary mb-3">
              <Mail className="w-5 h-5" />
            </div>
            <h3 className="font-display font-semibold mb-1">{T.contact.emailLabel}</h3>
            <a href={`mailto:${settings?.contactEmail}`} className="text-muted-foreground hover:text-foreground text-sm break-all">{settings?.contactEmail || "—"}</a>
          </div>
          <div className="card-soft">
            <div className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-primary/10 text-primary mb-3">
              <Phone className="w-5 h-5" />
            </div>
            <h3 className="font-display font-semibold mb-1">{T.contact.phoneLabel}</h3>
            <p className="text-muted-foreground text-sm">{settings?.contactPhone || "—"}</p>
          </div>
          <div className="card-soft">
            <div className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-primary/10 text-primary mb-3">
              <MapPin className="w-5 h-5" />
            </div>
            <h3 className="font-display font-semibold mb-1">{T.contact.office}</h3>
            <p className="text-muted-foreground text-sm">{T.contact.officeValue}</p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="card-soft md:col-span-2 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label-field">{T.contact.name}</label>
              <input required value={form.name} onChange={onChange("name")} className="input-field" />
            </div>
            <div>
              <label className="label-field">{T.contact.email}</label>
              <input required type="email" value={form.email} onChange={onChange("email")} className="input-field" />
            </div>
            <div>
              <label className="label-field">{T.contact.phone}</label>
              <input value={form.phone} onChange={onChange("phone")} className="input-field" />
            </div>
            <div>
              <label className="label-field">{T.contact.subject}</label>
              <input value={form.subject} onChange={onChange("subject")} className="input-field" />
            </div>
          </div>
          <div>
            <label className="label-field">{T.contact.message}</label>
            <textarea required rows={6} value={form.message} onChange={onChange("message")} className="input-field resize-y" />
          </div>
          {status === "success" && <div className="rounded-xl bg-accent/10 text-accent-foreground border border-accent/30 p-3 text-sm">{T.contact.success}</div>}
          {status === "error" && <div className="rounded-xl bg-destructive/10 text-destructive border border-destructive/30 p-3 text-sm">{error}</div>}
          <button disabled={status === "loading"} className="btn-primary w-full sm:w-auto">{status === "loading" ? "…" : T.contact.send}</button>
        </form>
      </section>
    </SitePage>
  );
}
