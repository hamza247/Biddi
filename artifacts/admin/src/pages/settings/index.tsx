import { useState, type ComponentType } from "react";
import { Card } from "@/components/ui/card";
import {
  Settings as SettingsIcon,
  Mail,
  MessageSquare,
  Share2,
  Smartphone,
  Wrench,
  Map,
  CreditCard,
  Bell,
  DollarSign,
} from "lucide-react";
import { GeneralTab } from "./GeneralTab";
import { EmailTab } from "./EmailTab";
import { SmsTab } from "./SmsTab";
import { SocialTab } from "./SocialTab";
import { AppSettingsTab } from "./AppSettingsTab";
import { InstallationTab } from "./InstallationTab";
import { MapsTab } from "./MapsTab";
import { PaymentTab } from "./PaymentTab";
import { NotificationSoundTab } from "./NotificationSoundTab";
import { CurrencyTab } from "./CurrencyTab";

type TabKey =
  | "general"
  | "email"
  | "sms"
  | "social"
  | "app"
  | "installation"
  | "maps"
  | "payment"
  | "notificationSound"
  | "currency";

interface TabDef {
  key: TabKey;
  label: string;
  icon: typeof SettingsIcon;
  Component: ComponentType;
}

const TABS: TabDef[] = [
  { key: "general", label: "General", icon: SettingsIcon, Component: GeneralTab },
  { key: "email", label: "Email", icon: Mail, Component: EmailTab },
  { key: "sms", label: "SMS", icon: MessageSquare, Component: SmsTab },
  { key: "social", label: "Social Media", icon: Share2, Component: SocialTab },
  { key: "app", label: "App Settings", icon: Smartphone, Component: AppSettingsTab },
  { key: "installation", label: "Installation Settings", icon: Wrench, Component: InstallationTab },
  { key: "maps", label: "Maps API Settings", icon: Map, Component: MapsTab },
  { key: "payment", label: "Payment", icon: CreditCard, Component: PaymentTab },
  { key: "notificationSound", label: "Notification Sound", icon: Bell, Component: NotificationSoundTab },
  { key: "currency", label: "Currency Management", icon: DollarSign, Component: CurrencyTab },
];

export default function SettingsPage() {
  const [active, setActive] = useState<TabKey>("general");
  const ActiveComponent = TABS.find((t) => t.key === active)?.Component ?? GeneralTab;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">General Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure every aspect of the platform — secrets are masked and never echoed back to the
          browser. Each tab has its own Save and Reset buttons.
        </p>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="border-b border-border overflow-x-auto">
          <div className="flex min-w-max">
            {TABS.map((t) => {
              const Icon = t.icon;
              const isActive = active === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActive(t.key)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                    isActive
                      ? "border-primary text-primary bg-primary/5"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  }`}
                  aria-pressed={isActive}
                  data-testid={`tab-${t.key}`}
                >
                  <Icon className="w-4 h-4" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="p-6">
          <ActiveComponent />
        </div>
      </Card>
    </div>
  );
}
