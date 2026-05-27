import { Link, useLocation } from "wouter";
import biddiLogo from "@assets/biddiride-logo_1777062947639.png";
import {
  LayoutDashboard,
  UserCheck,
  Users,
  Car,
  Settings,
  MapPin,
  Flame,
  Truck,
  Star,
  Layers,
  BarChart3,
  CreditCard,
  MessageSquare,
  FileText,
  Bell,
  BellOff,
  Globe,
  Trophy,
  Gavel,
  Wallet,
  LogOut,
  ChevronDown,
  ChevronRight,
  Tag,
  ShieldAlert,
  X,
  FileEdit,
  Inbox,
} from "lucide-react";
import type { ReactNode, ComponentType } from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { connectAdminSocket } from "@/lib/socket";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/live-map", label: "Live Map", icon: MapPin },
      { href: "/heat-view", label: "Heat View", icon: Flame },
    ],
  },
  {
    label: "Users",
    items: [
      { href: "/users", label: "Riders", icon: Users },
      { href: "/drivers", label: "Drivers", icon: UserCheck },
      { href: "/driver-applications", label: "Applications", icon: FileText },
    ],
  },
  {
    label: "Fleet",
    items: [
      { href: "/vehicles", label: "Vehicles", icon: Truck },
      { href: "/vehicle-types", label: "Service Categories", icon: Layers },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/rides", label: "Ride Requests", icon: Car },
      { href: "/bidding/posts", label: "Bidding Posts", icon: Gavel },
      { href: "/bids", label: "Bids", icon: Gavel },
      { href: "/trips", label: "Trips", icon: Star },
      { href: "/payments", label: "Payments", icon: CreditCard },
      { href: "/reviews", label: "Reviews", icon: MessageSquare },
    ],
  },
  {
    label: "Analytics",
    items: [
      { href: "/reports", label: "Reports", icon: BarChart3 },
      { href: "/service-areas", label: "Service Areas", icon: Globe },
      { href: "/referral-earnings", label: "Referral Earnings", icon: Users },
    ],
  },
  {
    label: "Config",
    items: [
      { href: "/vehicle-types", label: "Service Categories", icon: Layers },
      { href: "/reward-settings", label: "Rewards", icon: Trophy },
      { href: "/app-content", label: "App Content", icon: FileText },
      { href: "/notifications", label: "Notifications", icon: Bell },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

// Deduplicate and flatten for correct groups
const GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/live-map", label: "Live Map", icon: MapPin },
      { href: "/heat-view", label: "Heat View", icon: Flame },
    ],
  },
  {
    label: "Users & Drivers",
    items: [
      { href: "/users", label: "Riders", icon: Users },
      { href: "/drivers", label: "Drivers", icon: UserCheck },
      { href: "/driver-applications", label: "Applications", icon: FileText },
      { href: "/vehicles", label: "Vehicles", icon: Truck },
      { href: "/vehicle-types", label: "Service Categories", icon: Layers },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/rides", label: "Ride Requests", icon: Car },
      { href: "/bidding/posts", label: "Bidding Posts", icon: Gavel },
      { href: "/bids", label: "Bids", icon: Gavel },
      { href: "/trips", label: "Trips", icon: Star },
      { href: "/payments", label: "Payments", icon: CreditCard },
      { href: "/withdrawals", label: "Withdrawals", icon: Wallet },
      { href: "/reviews", label: "Reviews", icon: MessageSquare },
    ],
  },
  {
    label: "Safety",
    items: [
      { href: "/safety-alerts", label: "Safety Alerts", icon: ShieldAlert },
    ],
  },
  {
    label: "Analytics",
    items: [
      { href: "/reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    label: "Geo Fence",
    items: [
      { href: "/geo-fence/locations", label: "Geo Fence Locations", icon: Globe },
      { href: "/geo-fence/restricted-areas", label: "Restricted Areas", icon: Globe },
      { href: "/geo-fence/location-wise-fare", label: "Location Wise Fare", icon: Globe },
      { href: "/geo-fence/airport-surcharges", label: "Airport Surcharge", icon: Globe },
      { href: "/geo-fence/weather-surcharge", label: "Weather Surcharge", icon: Globe },
      { href: "/geo-fence/countries", label: "Countries", icon: Globe },
    ],
  },
  {
    label: "Website",
    items: [
      { href: "/website/pages", label: "Pages", icon: FileEdit },
      { href: "/website/submissions", label: "Contact Inbox", icon: Inbox },
      { href: "/website/settings", label: "Site Settings", icon: Settings },
    ],
  },
  {
    label: "Configuration",
    items: [
      { href: "/app-classes", label: "Class Keys", icon: Tag },
      { href: "/coupons", label: "Coupons", icon: Tag },
      { href: "/driver-promotions", label: "Driver Promotions", icon: Trophy },
      { href: "/reward-settings", label: "Rewards", icon: Trophy },
      { href: "/referral-settings", label: "Referral Settings", icon: Users },
      { href: "/mlm-report", label: "MLM Referral Report", icon: Users },
      { href: "/app-content", label: "App Content", icon: FileText },
      { href: "/notifications", label: "Notifications", icon: Bell },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function SidebarGroup({ group, loc }: { group: NavGroup; loc: string }) {
  const hasActive = group.items.some(
    (n) => loc === n.href || (n.href !== "/" && loc.startsWith(n.href)),
  );
  const [open, setOpen] = useState(true);

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 hover:text-sidebar-foreground/60 transition-colors"
      >
        <span>{group.label}</span>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5">
          {group.items.map((n) => {
            const active = loc === n.href || (n.href !== "/" && loc.startsWith(n.href));
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">{n.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface SafetyAlert {
  id: string;
  rideId: string;
  triggeredByName: string | null;
  triggeredByLastName: string | null;
  triggeredByCountryCode: string | null;
  triggeredByPhone: string | null;
  createdAt: string;
}

const POLL_INTERVAL_MS = 300_000;
const MUTE_STORAGE_KEY = "biddi_alert_sound_muted";

function playAlertSound() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    const tones = [880, 1100, 880];
    const toneDuration = 0.18;
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * toneDuration;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.4, start + 0.02);
      gain.gain.linearRampToValueAtTime(0, start + 0.15);
      osc.start(start);
      osc.stop(start + toneDuration);
    });
    const totalDurationMs = (tones.length * toneDuration + 0.1) * 1000;
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, totalDurationMs);
  } catch {
  }
}

function useSafetyAlerts(muted: boolean) {
  const [alerts, setAlerts] = useState<SafetyAlert[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const { admin } = useAuth();

  const fetchAlerts = useCallback(async () => {
    if (!admin) return;
    try {
      const data = await api<{ alerts: SafetyAlert[] }>("/safety-alerts/active");
      const incoming = data.alerts;
      const newAlerts = incoming.filter((a) => !seenIdsRef.current.has(a.id));
      if (newAlerts.length > 0 && !muted) {
        playAlertSound();
      }
      newAlerts.forEach((a) => seenIdsRef.current.add(a.id));
      setAlerts(incoming);
    } catch {
    }
  }, [admin, muted]);

  useEffect(() => {
    if (!admin) return;

    fetchAlerts();
    const timer = setInterval(fetchAlerts, POLL_INTERVAL_MS);

    const socket = connectAdminSocket();
    if (socket) {
      socket.on("safety:alert", (alert: SafetyAlert) => {
        setAlerts((prev) => {
          if (prev.some((a) => a.id === alert.id)) return prev;
          return [alert, ...prev];
        });
      });
    }

    return () => {
      clearInterval(timer);
      if (socket) {
        socket.off("safety:alert");
      }
    };
  }, [admin, fetchAlerts]);

  const dismiss = useCallback(async (id: string) => {
    try {
      await api(`/safety-alerts/${id}/resolve`, { method: "PATCH" });
      seenIdsRef.current.delete(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch {
    }
  }, []);

  return { alerts, dismiss };
}

export function Layout({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const { admin, logout } = useAuth();
  const [muted, setMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MUTE_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(MUTE_STORAGE_KEY, String(next));
      } catch {
      }
      return next;
    });
  }, []);

  const { alerts, dismiss } = useSafetyAlerts(muted);

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar */}
      <aside className="w-52 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border flex-shrink-0">
        {/* Logo */}
        <div className="px-4 py-3 flex items-center border-b border-sidebar-border">
          <img src={biddiLogo} alt="Biddi" className="h-8 w-auto" />
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {GROUPS.map((group) => (
            <SidebarGroup key={group.label} group={group} loc={loc} />
          ))}
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-sidebar-border">
          <div className="text-[10px] text-sidebar-foreground/40 mb-0.5">Super Administrator</div>
          <div className="text-xs font-medium mb-2 truncate">{admin?.email}</div>
          <Button
            size="sm"
            variant="outline"
            onClick={logout}
            data-testid="button-logout"
            className="w-full text-[11px] h-7 bg-sidebar-accent border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent/80"
          >
            <LogOut className="w-3 h-3 mr-1.5" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-12 flex items-center gap-4 px-6 bg-card border-b border-border flex-shrink-0">
          <div className="flex-1">
            <span className="font-semibold text-sm">Biddi Rides Admin</span>
            <span className="text-muted-foreground text-xs ml-2 hidden sm:inline">Super Administrator</span>
          </div>
          <div className="flex items-center gap-3 text-muted-foreground text-xs">
            {alerts.length > 0 && (
              <span className="relative flex h-4 w-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500" />
              </span>
            )}
            <button
              onClick={toggleMute}
              title={muted ? "Unmute alert sounds" : "Mute alert sounds"}
              className="hover:text-foreground transition-colors"
            >
              {muted ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
            </button>
            <Settings className="w-4 h-4 cursor-pointer hover:text-foreground" />
          </div>
        </header>

        {/* Safety alert banners */}
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className="flex items-center gap-3 px-5 py-3 bg-red-600 text-white text-sm flex-shrink-0"
          >
            <ShieldAlert className="w-5 h-5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-semibold">Safety Alert — </span>
              <span>
                {[alert.triggeredByName, alert.triggeredByLastName].filter(Boolean).join(" ") || "Unknown user"}
                {alert.triggeredByPhone ? ` (${alert.triggeredByCountryCode ?? ""}${alert.triggeredByPhone})` : ""}
                {" triggered an alert on trip "}
                <span className="font-mono font-semibold">{alert.rideId.slice(0, 8)}</span>
              </span>
            </div>
            <button
              onClick={() => dismiss(alert.id)}
              className="flex-shrink-0 flex items-center gap-1.5 bg-white/20 hover:bg-white/30 transition-colors rounded-md px-3 py-1 text-xs font-semibold"
            >
              <X className="w-3.5 h-3.5" />
              Dismiss
            </button>
          </div>
        ))}

        {/* Content */}
        <main className="flex-1 overflow-auto">
          <div className="max-w-[1400px] mx-auto px-6 py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
