import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ImagePicker } from "@/components/ImagePicker";

interface Settings {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  contactEmail: string;
  contactNotificationEmail: string;
  contactPhone: string;
  socialFacebook: string;
  socialTwitter: string;
  socialInstagram: string;
  socialLinkedin: string;
  appStoreUrl: string;
  playStoreUrl: string;
  defaultOgImage: string;
  siteUrl: string;
  footerLogoUrl: string;
  headerLogoUrl: string;
}

const LOGO_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"];
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const FOOTER_LOGO_TYPES = LOGO_TYPES;
const FOOTER_LOGO_MAX_BYTES = LOGO_MAX_BYTES;

const FIELDS: { key: keyof Settings; label: string; multiline?: boolean }[] = [
  { key: "siteUrl", label: "Site URL (e.g. https://biddirides.com)" },
  { key: "contactEmail", label: "Contact email (shown publicly)" },
  { key: "contactNotificationEmail", label: "Notifications inbox (new contact submissions)" },
  { key: "contactPhone", label: "Contact phone" },
  { key: "socialFacebook", label: "Facebook URL" },
  { key: "socialTwitter", label: "Twitter / X URL" },
  { key: "socialInstagram", label: "Instagram URL" },
  { key: "socialLinkedin", label: "LinkedIn URL" },
  { key: "appStoreUrl", label: "App Store URL" },
  { key: "playStoreUrl", label: "Google Play URL" },
  { key: "defaultOgImage", label: "Default OG image URL" },
];

export default function WebsiteSettingsPage() {
  const { data } = useQuery({
    queryKey: ["admin-site-settings"],
    queryFn: () => api<{ settings: Settings }>("/admin/site/settings").then((r) => r.settings),
  });
  const [s, setS] = useState<Settings | null>(null);
  const [persisted, setPersisted] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (data) { setS(data); setPersisted(data); } }, [data]);

  if (!s) return <div className="p-6 text-muted-foreground">Loading…</div>;

  const onSave = async () => {
    setSaving(true);
    try {
      const res = await api<{ settings: Settings }>("/admin/site/settings", { method: "PATCH", json: s });
      setPersisted(res.settings);
      setS(res.settings);
      toast.success("Settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Website Settings</h1>
          <p className="text-sm text-muted-foreground">Maintenance mode, contact info, social links, app store URLs.</p>
        </div>
        <Button onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
      </div>
      <div className="space-y-6">
        <section className="bg-card border border-border rounded-lg p-5 space-y-4">
          <h2 className="font-semibold">Header Logo</h2>
          <p className="text-xs text-muted-foreground">
            Upload an image to replace the default text logo in the website header/navbar.
            PNG, JPG, JPEG, SVG, or WEBP. Max 2MB. Rendered at up to 40px tall on the website.
          </p>
          <div>
            <Label className="!mb-2 block">Currently active</Label>
            {persisted?.headerLogoUrl ? (
              <div className="border border-border rounded p-3 bg-muted/30 inline-block">
                <img src={persisted.headerLogoUrl} alt="Current header logo" className="max-h-10 w-auto object-contain" />
              </div>
            ) : (
              <div className="text-xs text-muted-foreground italic">Default logo</div>
            )}
            {persisted && persisted.headerLogoUrl !== s.headerLogoUrl && (
              <p className="text-xs text-amber-600 mt-2">Unsaved changes — click "Save changes" to apply.</p>
            )}
          </div>
          <ImagePicker
            label="Upload new header logo"
            value={s.headerLogoUrl}
            onChange={(url) => setS({ ...s, headerLogoUrl: url })}
            accept={LOGO_TYPES.join(",")}
            acceptTypes={LOGO_TYPES}
            maxBytes={LOGO_MAX_BYTES}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setS({ ...s, headerLogoUrl: "" })}
              disabled={!s.headerLogoUrl}
            >
              Remove Logo
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setS({ ...s, headerLogoUrl: "" })}
            >
              Restore Default Logo
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Click "Save changes" above to apply. Remove and Restore Default both clear the custom logo.
          </p>
        </section>
        <section className="bg-card border border-border rounded-lg p-5 space-y-4">
          <h2 className="font-semibold">Footer Logo</h2>
          <p className="text-xs text-muted-foreground">
            Upload an image to replace the default text logo in the website footer.
            PNG, JPG, JPEG, SVG, or WEBP. Max 2MB. Rendered at up to 48px tall on the website.
          </p>
          <div>
            <Label className="!mb-2 block">Currently active</Label>
            {persisted?.footerLogoUrl ? (
              <div className="border border-border rounded p-3 bg-muted/30 inline-block">
                <img src={persisted.footerLogoUrl} alt="Current footer logo" className="max-h-12 w-auto object-contain" />
              </div>
            ) : (
              <div className="text-xs text-muted-foreground italic">Default logo</div>
            )}
            {persisted && persisted.footerLogoUrl !== s.footerLogoUrl && (
              <p className="text-xs text-amber-600 mt-2">Unsaved changes — click "Save changes" to apply.</p>
            )}
          </div>
          <ImagePicker
            label="Upload new footer logo"
            value={s.footerLogoUrl}
            onChange={(url) => setS({ ...s, footerLogoUrl: url })}
            accept={FOOTER_LOGO_TYPES.join(",")}
            acceptTypes={FOOTER_LOGO_TYPES}
            maxBytes={FOOTER_LOGO_MAX_BYTES}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setS({ ...s, footerLogoUrl: "" })}
              disabled={!s.footerLogoUrl}
            >
              Remove Logo
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setS({ ...s, footerLogoUrl: "" })}
            >
              Restore Default Logo
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Click "Save changes" above to apply. Remove and Restore Default both clear the custom logo.
          </p>
        </section>
        <section className="bg-card border border-border rounded-lg p-5 space-y-4">
          <h2 className="font-semibold">Maintenance mode</h2>
          <div className="flex items-center gap-3">
            <Switch checked={s.maintenanceMode} onCheckedChange={(v) => setS({ ...s, maintenanceMode: v })} />
            <Label className="!mb-0">When ON, the public website shows a maintenance page</Label>
          </div>
          <div>
            <Label>Maintenance message</Label>
            <Textarea rows={3} value={s.maintenanceMessage} onChange={(e) => setS({ ...s, maintenanceMessage: e.target.value })} />
          </div>
        </section>
        <section className="bg-card border border-border rounded-lg p-5 space-y-4">
          <h2 className="font-semibold">Site information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {FIELDS.map((f) => (
              <div key={f.key} className={f.multiline ? "md:col-span-2" : ""}>
                <Label>{f.label}</Label>
                <Input value={(s[f.key] as string) ?? ""} onChange={(e) => setS({ ...s, [f.key]: e.target.value })} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
