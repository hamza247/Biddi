import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { Send } from "lucide-react";
import { SettingsForm } from "./SettingsForm";
import type { SectionDef } from "./types";

const SECTIONS: SectionDef[] = [
  {
    title: "Sender identity",
    fields: [
      { key: "fromName", label: "From name", kind: "text", placeholder: "Biddi" },
      { key: "noReplyEmail", label: "No-reply email", kind: "email", placeholder: "noreply@biddi.app" },
      { key: "adminEmail", label: "Admin email", kind: "email", placeholder: "ops@biddi.app" },
      { key: "sendingDomain", label: "Sending domain", kind: "url", placeholder: "https://biddi.app" },
      {
        key: "mailDeliveryEnabled",
        label: "Enable mail delivery service",
        kind: "boolean",
        help: "Master switch for outgoing email. Turn off to suppress all transactional mail.",
      },
      { key: "mailFooter", label: "Mail footer", kind: "textarea", placeholder: "© Biddi — All rights reserved" },
    ],
  },
  {
    title: "SMTP server",
    description: "Outbound mail server used for invoices, OTPs and notifications.",
    fields: [
      { key: "smtpHost", label: "SMTP host", kind: "text", placeholder: "smtp.example.com" },
      { key: "smtpPort", label: "Port", kind: "number", min: 1, max: 65535 },
      { key: "smtpUser", label: "Username", kind: "text", placeholder: "you@example.com" },
      { key: "smtpPass", label: "Password", kind: "secret" },
      { key: "smtpFrom", label: "From address", kind: "text", placeholder: "Biddi <noreply@biddi.app>" },
      {
        key: "smtpSecure",
        label: "Use TLS (secure)",
        kind: "boolean",
        help: "Enable for port 465 (SMTPS). Leave off for port 587 (STARTTLS).",
      },
    ],
  },
];

export function EmailTab() {
  const [testTo, setTestTo] = useState("");
  const send = useMutation({
    mutationFn: (to: string) =>
      api<{ ok: boolean }>("/admin/settings/test-email", { method: "POST", json: { to } }),
    onSuccess: () => toast({ title: "Test email sent", description: `Email sent to ${testTo}.` }),
    onError: (err: Error) =>
      toast({ title: "Send failed", description: err.message, variant: "destructive" }),
  });

  const onSend = () => {
    const v = testTo.trim();
    if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      toast({ title: "Enter a valid email address", variant: "destructive" });
      return;
    }
    send.mutate(v);
  };

  return (
    <SettingsForm
      tab="email"
      sections={SECTIONS}
      after={() => (
        <div className="rounded-lg border border-border p-4">
          <div className="text-sm font-medium mb-1">Send a test email</div>
          <div className="text-xs text-muted-foreground mb-3">
            Uses the currently saved SMTP settings. Save changes before testing.
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="test@example.com"
              className="flex-1"
            />
            <Button variant="outline" onClick={onSend} disabled={send.isPending}>
              <Send className="w-4 h-4 mr-2" />
              Send test
            </Button>
          </div>
        </div>
      )}
    />
  );
}
