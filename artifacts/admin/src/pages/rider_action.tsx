import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useDisplayCurrency, useFormatCurrency } from "@/lib/use-display-currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, User, ShieldCheck, ShieldOff, Network } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface UserDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  gender: string | null;
  country: string | null;
  city: string | null;
  photoUrl: string | null;
  walletBalance: string;
  walletBalanceDisplay?: { amountUsd: number; displayAmount: number; displayCurrency: string; displaySymbol: string } | null;
  isActive: boolean;
  phoneVerified: boolean;
  appMode: "rider" | "driver";
  driverStatus: string;
  rating: number;
  trips: number;
  createdAt: string;
}

interface TreeNode {
  id: string;
  name: string;
  level: number;
  children: TreeNode[];
}

interface TreeResp {
  user: { id: string; name: string };
  children: TreeNode[];
}

const LEVEL_BADGE: Record<number, string> = {
  1: "bg-blue-600 text-white",
  2: "bg-orange-500 text-white",
  3: "bg-green-600 text-white",
};

function ReferralNode({ node }: { node: TreeNode }) {
  const badge = LEVEL_BADGE[node.level] ?? "bg-primary text-primary-foreground";
  return (
    <div className="flex flex-col items-center min-w-[120px]">
      <div className="rounded-lg border bg-card px-3 py-2 text-center shadow-sm w-full max-w-[180px]">
        <div className="text-xs font-semibold break-words" title={node.name}>
          {node.name}
        </div>
        <span
          className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${badge}`}
        >
          L{node.level}
        </span>
      </div>
      {node.children.length > 0 && (
        <>
          <div className="w-px h-3 bg-border" />
          <div className="flex items-start gap-3 pt-3 border-t border-border">
            {node.children.map((child) => (
              <ReferralNode key={child.id} node={child} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ReferralTreePanel({ userId }: { userId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["/referrals/tree", userId],
    queryFn: () => api<TreeResp>(`/referrals/tree?userId=${userId}`),
    enabled: !!userId,
  });

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Network className="w-4 h-4" /> Referral Tree
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-6 text-sm text-muted-foreground">Loading tree…</div>
        ) : isError || !data ? (
          <div className="py-6 text-sm text-muted-foreground">
            Could not load referral tree.
          </div>
        ) : data.children.length === 0 ? (
          <div className="py-6 text-sm text-muted-foreground">No referrals yet.</div>
        ) : (
          <div className="overflow-x-auto pb-2">
            <div className="flex flex-col items-center min-w-min">
              <div className="rounded-lg border-2 border-primary bg-primary/5 px-4 py-2 text-center shadow-sm max-w-[220px]">
                <div className="text-sm font-bold break-words" title={data.user.name}>
                  {data.user.name}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">
                  Root
                </div>
              </div>
              <div className="w-px h-3 bg-border" />
              <div className="flex items-start gap-3 pt-3 border-t border-border">
                {data.children.map((child) => (
                  <ReferralNode key={child.id} node={child} />
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function RiderActionPage() {
  const displayCurrency = useDisplayCurrency();
  const formatAmount = useFormatCurrency();
  const { userId } = useParams<{ userId: string }>();
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["/admin/users", userId],
    queryFn: () => api<{ user: UserDetail }>(`/admin/users/${userId}`),
    enabled: !!userId,
  });

  const user = data?.user;

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    gender: "" as "" | "male" | "female",
    country: "",
    city: "",
    photoUrl: "",
    phoneVerified: false,
    password: "",
  });

  useEffect(() => {
    if (user) {
      setForm({
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
        email: user.email ?? "",
        phone: user.phone ?? "",
        gender: (user.gender as "" | "male" | "female") ?? "",
        country: user.country ?? "",
        city: user.city ?? "",
        photoUrl: user.photoUrl ?? "",
        phoneVerified: user.phoneVerified ?? false,
        password: "",
      });
    }
  }, [user]);

  const updateMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/admin/users/${userId}`, { method: "PATCH", json: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/admin/users"] });
      qc.invalidateQueries({ queryKey: ["/admin/users", userId] });
      toast({ title: "User updated successfully" });
      navigate("/users");
    },
    onError: () => toast({ title: "Failed to save changes", variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {
      firstName: form.firstName.trim() || undefined,
      lastName: form.lastName.trim() || undefined,
      email: form.email.trim() || null,
      phone: form.phone.trim() || undefined,
      gender: form.gender || null,
      country: form.country.trim() || null,
      city: form.city.trim() || null,
      photoUrl: form.photoUrl.trim() || null,
      phoneVerified: form.phoneVerified,
    };
    if (form.password.trim()) {
      body.password = form.password.trim();
    }
    updateMut.mutate(body);
  };

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (isError || !user) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <p className="text-muted-foreground">User not found.</p>
        <Button variant="outline" onClick={() => navigate("/users")}>
          Back to Users
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/users")} className="gap-1">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Edit User</h1>
          <p className="text-sm text-muted-foreground">
            {user.firstName} {user.lastName} · {user.phone}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-6 p-4 rounded-lg border bg-muted/30">
        {form.photoUrl ? (
          <img
            src={form.photoUrl}
            alt=""
            className="w-14 h-14 rounded-full object-cover border-2 border-border"
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="w-7 h-7 text-primary/60" />
          </div>
        )}
        <div>
          <div className="font-semibold text-lg">
            {[user.firstName, user.lastName].filter(Boolean).join(" ") || "—"}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={user.isActive ? "default" : "secondary"} className={user.isActive ? "bg-green-100 text-green-700" : ""}>
              {user.isActive ? "Active" : "Inactive"}
            </Badge>
            {user.phoneVerified ? (
              <span className="flex items-center gap-1 text-xs text-green-600">
                <ShieldCheck className="w-3.5 h-3.5" /> Verified
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <ShieldOff className="w-3.5 h-3.5" /> Not verified
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              ★ {user.rating.toFixed(2)} · {user.trips} trips
            </span>
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-xs text-muted-foreground">Wallet</div>
          <div className="font-bold text-lg">{user.walletBalanceDisplay
            ? `${user.walletBalanceDisplay.displaySymbol}${user.walletBalanceDisplay.displayAmount.toFixed(2)}`
            : formatAmount(parseFloat(user.walletBalance ?? "0"), displayCurrency.code)}</div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Personal Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={form.firstName}
                  onChange={set("firstName")}
                  placeholder="First name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={form.lastName}
                  onChange={set("lastName")}
                  placeholder="Last name"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gender">Gender</Label>
              <select
                id="gender"
                value={form.gender}
                onChange={set("gender")}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="">— Not specified —</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="photoUrl">Photo URL</Label>
              <Input
                id="photoUrl"
                type="url"
                value={form.photoUrl}
                onChange={set("photoUrl")}
                placeholder="https://…"
              />
              {form.photoUrl && (
                <img
                  src={form.photoUrl}
                  alt="Preview"
                  className="w-16 h-16 rounded-full object-cover border mt-1"
                  onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                />
              )}
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="phoneVerified"
                checked={form.phoneVerified}
                onChange={(e) => setForm((f) => ({ ...f, phoneVerified: e.target.checked }))}
                className="rounded border-gray-300 w-4 h-4"
              />
              <Label htmlFor="phoneVerified" className="cursor-pointer font-normal">
                Phone number verified
              </Label>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={set("phone")}
                placeholder="+1234567890"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={set("email")}
                placeholder="user@example.com"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="country">Country</Label>
                <Input
                  id="country"
                  value={form.country}
                  onChange={set("country")}
                  placeholder="Morocco"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={form.city}
                  onChange={set("city")}
                  placeholder="Casablanca"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">Password</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              <Label htmlFor="password">
                New Password{" "}
                <span className="text-muted-foreground font-normal">
                  (Leave blank to retain assigned password)
                </span>
              </Label>
              <Input
                id="password"
                type="password"
                value={form.password}
                onChange={set("password")}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>
          </CardContent>
        </Card>

        <ReferralTreePanel userId={userId!} />

        <div className="flex gap-3 mt-6 pb-8">
          <Button
            type="submit"
            disabled={updateMut.isPending}
            className="flex-1"
          >
            {updateMut.isPending ? "Saving…" : "Save Changes"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate("/users")}
            className="flex-1"
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
