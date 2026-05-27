import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TableHead, TableRow, TableCell } from "@/components/ui/table";
import {
  ConfirmDialog,
  DataTable,
  DataTablePagination,
  EmptyState,
  FilterBar,
  SearchInput,
  SortableHeader,
  StatusBadge,
  sortRows,
  useSort,
} from "@/components/admin";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { useMemo, useRef, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  ImageOff,
  Info,
  Users,
  Accessibility,
  Heart,
  PawPrint,
  Car,
  Bike,
  AlertTriangle,
  X,
  Upload,
  Loader2,
} from "lucide-react";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/gif",
];

interface PeakWindow {
  days: number[];
  startTime: string;
  endTime: string;
  multiplier: number;
}

interface VehicleType {
  id: string;
  name: string;
  description: string | null;
  vehicleCategory: "car" | "moto";
  poolEnabled: boolean;
  wheelchairAccess: boolean;
  assistAvailable: boolean;
  petFriendly: boolean;
  fareModelStrategy: "incremental" | "fixed";
  pricePerKm: number;
  pricePerMin: number;
  baseFare: number;
  minimumFare: number;
  commissionPercent: number;
  cancellationTimeLimitMin: number;
  cancellationCharge: number;
  waitingTimeLimitMin: number;
  waitingCharge: number;
  inTransitWaitingFeePerMin: number;
  personCapacity: number;
  peakSurchargeEnabled: boolean;
  peakSurchargeWindows: PeakWindow[];
  nightChargeEnabled: boolean;
  nightChargeStart: string | null;
  nightChargeEnd: string | null;
  nightChargeMultiplier: number;
  displayOrder: number;
  active: boolean;
  iconUrl: string | null;
  classKey: string | null;
  serviceAreaIds: string[];
  createdAt: string;
}

interface ServiceArea {
  id: string;
  name: string;
  country: string;
}

interface FormState {
  name: string;
  description: string;
  vehicleCategory: "car" | "moto";
  poolEnabled: boolean;
  wheelchairAccess: boolean;
  assistAvailable: boolean;
  petFriendly: boolean;
  fareModelStrategy: "incremental" | "fixed";
  pricePerKm: number;
  pricePerMin: number;
  baseFare: number;
  minimumFare: number;
  commissionPercent: number;
  cancellationTimeLimitMin: number;
  cancellationCharge: number;
  waitingTimeLimitMin: number;
  waitingCharge: number;
  inTransitWaitingFeePerMin: number;
  personCapacity: number;
  peakSurchargeEnabled: boolean;
  peakSurchargeWindows: PeakWindow[];
  nightChargeEnabled: boolean;
  nightChargeStart: string;
  nightChargeEnd: string;
  nightChargeMultiplier: number;
  displayOrder: number;
  active: boolean;
  iconUrl: string;
  classKey: string;
  serviceAreaIds: string[];
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  vehicleCategory: "car",
  poolEnabled: false,
  wheelchairAccess: false,
  assistAvailable: false,
  petFriendly: false,
  fareModelStrategy: "incremental",
  pricePerKm: 3.5,
  pricePerMin: 0.5,
  baseFare: 10,
  minimumFare: 15,
  commissionPercent: 15,
  cancellationTimeLimitMin: 5,
  cancellationCharge: 0,
  waitingTimeLimitMin: 3,
  waitingCharge: 0,
  inTransitWaitingFeePerMin: 0,
  personCapacity: 4,
  peakSurchargeEnabled: false,
  peakSurchargeWindows: [],
  nightChargeEnabled: false,
  nightChargeStart: "22:00",
  nightChargeEnd: "06:00",
  nightChargeMultiplier: 1.25,
  displayOrder: 0,
  active: true,
  iconUrl: "",
  classKey: "",
  serviceAreaIds: [],
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const SECTION_HEADER =
  "text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2";

const CLASS_KEY_PALETTES = [
  "bg-blue-100 text-blue-700 border-blue-200",
  "bg-violet-100 text-violet-700 border-violet-200",
  "bg-amber-100 text-amber-700 border-amber-200",
  "bg-emerald-100 text-emerald-700 border-emerald-200",
  "bg-rose-100 text-rose-700 border-rose-200",
  "bg-cyan-100 text-cyan-700 border-cyan-200",
  "bg-orange-100 text-orange-700 border-orange-200",
  "bg-indigo-100 text-indigo-700 border-indigo-200",
];

function classKeyColor(key: string): string {
  const FIXED: Record<string, string> = {
    ride: "bg-blue-100 text-blue-700 border-blue-200",
    comfort: "bg-violet-100 text-violet-700 border-violet-200",
    moto: "bg-amber-100 text-amber-700 border-amber-200",
  };
  if (FIXED[key]) return FIXED[key];
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return CLASS_KEY_PALETTES[hash % CLASS_KEY_PALETTES.length];
}

export default function VehicleTypesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<VehicleType | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VehicleType | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [iconPreviewError, setIconPreviewError] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | undefined | null) => {
    if (!file) return;
    setUploadError(null);
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      const msg = "Only PNG, JPEG, WebP, GIF or SVG images are allowed.";
      setUploadError(msg);
      toast({ title: "Unsupported file type", description: msg, variant: "destructive" });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      const msg = "Image must be 5 MB or smaller.";
      setUploadError(msg);
      toast({ title: "File too large", description: msg, variant: "destructive" });
      return;
    }

    setIsUploading(true);
    setUploadProgress(10);
    try {
      // 1. Ask the API for a presigned upload URL (admin-auth via api()).
      const { uploadURL, objectPath } = await api<{
        uploadURL: string;
        objectPath: string;
      }>("/storage/uploads/request-url", {
        method: "POST",
        json: {
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
        },
      });

      // 2. PUT the file bytes directly to GCS.
      setUploadProgress(40);
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!putRes.ok) throw new Error("Upload to storage failed");

      // 3. Finalize: stamp the object with a public-read ACL so the rider
      //    app can load it without auth.
      setUploadProgress(80);
      await api("/storage/uploads/finalize", {
        method: "POST",
        json: { objectPath },
      });

      const url = `/api/storage${objectPath}`;
      setForm((f) => ({ ...f, iconUrl: url }));
      setIconPreviewError(false);
      setUploadProgress(100);
      toast({ title: "Vehicle picture uploaded" });
    } catch (err) {
      const description =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Please try again.";
      setUploadError(description);
      toast({ title: "Upload failed", description, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  interface AppClass {
    id: string;
    slug: string;
    label: string;
    colorHex: string | null;
    isBuiltIn: boolean;
  }

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "vehicle-types"],
    queryFn: () => api<{ vehicleTypes: VehicleType[] }>("/admin/vehicle-types"),
  });

  const VT_PAGE_SIZE = 25;
  const [vtSearch, setVtSearch] = useState("");
  const [vtCategory, setVtCategory] = useState("all");
  const [vtPage, setVtPage] = useState(1);
  const [vtSort, setVtSort] = useSort<"name" | "baseFare">({
    key: "name",
    direction: "asc",
  });
  const vtAll = data?.vehicleTypes ?? [];
  const vtFiltered = useMemo(() => {
    const q = vtSearch.trim().toLowerCase();
    return vtAll.filter((vt) => {
      if (vtCategory !== "all" && vt.vehicleCategory !== vtCategory) return false;
      if (q && !`${vt.name} ${vt.description ?? ""} ${vt.classKey ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [vtAll, vtSearch, vtCategory]);
  const vtSorted = useMemo(() => sortRows(vtFiltered, vtSort, (vt, k) => vt[k]), [vtFiltered, vtSort]);
  const vtPaged = vtSorted.slice((vtPage - 1) * VT_PAGE_SIZE, vtPage * VT_PAGE_SIZE);

  const { data: areasData } = useQuery({
    queryKey: ["admin", "service-areas"],
    queryFn: () => api<{ serviceAreas: ServiceArea[] }>("/admin/service-areas"),
  });

  const { data: classesData } = useQuery({
    queryKey: ["admin", "app-classes"],
    queryFn: () => api<{ appClasses: AppClass[] }>("/admin/app-classes"),
  });

  const appClasses: AppClass[] = classesData?.appClasses ?? [];

  const serviceAreas = areasData?.serviceAreas ?? [];
  const serviceAreaMap = useMemo(
    () => Object.fromEntries(serviceAreas.map((a) => [a.id, a])),
    [serviceAreas],
  );

  const classColorMap = useMemo(
    () => Object.fromEntries(appClasses.map((c) => [c.slug, c.colorHex])),
    [appClasses],
  );

  const save = useMutation({
    mutationFn: (payload: FormState) => {
      const body = {
        ...payload,
        description: payload.description || null,
        classKey: payload.classKey || null,
        nightChargeStart: payload.nightChargeEnabled ? payload.nightChargeStart : null,
        nightChargeEnd: payload.nightChargeEnabled ? payload.nightChargeEnd : null,
        peakSurchargeWindows: payload.peakSurchargeEnabled
          ? payload.peakSurchargeWindows
          : [],
      };
      return editing
        ? api(`/admin/vehicle-types/${editing.id}`, { method: "PATCH", json: body })
        : api("/admin/vehicle-types", { method: "POST", json: body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "vehicle-types"] });
      toast({ title: editing ? "Service category updated" : "Service category created" });
      setOpen(false);
    },
    onError: (err: unknown) => {
      let description: string | React.ReactNode;
      if (err instanceof ApiError && err.details && err.details.length > 0) {
        const FIELD_LABELS: Record<string, string> = {
          name: "Name",
          description: "Description",
          vehicleCategory: "Vehicle category",
          fareModelStrategy: "Fare strategy",
          pricePerKm: "Price per km",
          pricePerMin: "Price per min",
          baseFare: "Base fare",
          minimumFare: "Minimum fare",
          commissionPercent: "Commission %",
          cancellationTimeLimitMin: "Cancellation time limit",
          cancellationCharge: "Cancellation charge",
          waitingTimeLimitMin: "Waiting time limit",
          waitingCharge: "Waiting charge",
          inTransitWaitingFeePerMin: "In-transit waiting fee",
          personCapacity: "Person capacity",
          nightChargeStart: "Night charge start",
          nightChargeEnd: "Night charge end",
          nightChargeMultiplier: "Night charge multiplier",
          displayOrder: "Display order",
          iconUrl: "Icon",
          classKey: "Class key",
          serviceAreaIds: "Service areas",
        };
        const lines = err.details.map((d) => {
          if (!Array.isArray(d.path) || d.path.length === 0) return d.message ?? "Unknown error";
          const root = String(d.path[0]);
          const label = FIELD_LABELS[root] ?? root;
          const suffix = d.path.length > 1 ? ` (${d.path.slice(1).join(".")})` : "";
          return `${label}${suffix}: ${d.message ?? "invalid"}`;
        });
        const MAX_LINES = 5;
        const shown = lines.slice(0, MAX_LINES);
        if (lines.length > MAX_LINES) shown.push(`…and ${lines.length - MAX_LINES} more`);
        description = <span style={{ whiteSpace: "pre-line" }}>{shown.join("\n")}</span>;
      } else if (err instanceof ApiError || err instanceof Error) {
        description = err.message;
      } else {
        description = "Please check the form and try again.";
      }
      toast({
        title: "Error saving",
        description,
        variant: "destructive",
      });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/vehicle-types/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "vehicle-types"] });
      toast({ title: "Service category deleted" });
      setDeleteTarget(null);
    },
    onError: (err: unknown) => {
      const msg = err instanceof ApiError ? err.message : "Something went wrong.";
      toast({ title: "Could not delete", description: msg, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setIconPreviewError(false);
    setUploadError(null);
    setOpen(true);
  };

  const openEdit = (vt: VehicleType) => {
    setEditing(vt);
    setForm({
      name: vt.name,
      description: vt.description ?? "",
      vehicleCategory: vt.vehicleCategory,
      poolEnabled: vt.poolEnabled,
      wheelchairAccess: vt.wheelchairAccess,
      assistAvailable: vt.assistAvailable,
      petFriendly: vt.petFriendly,
      fareModelStrategy: vt.fareModelStrategy,
      pricePerKm: vt.pricePerKm,
      pricePerMin: vt.pricePerMin,
      baseFare: vt.baseFare,
      minimumFare: vt.minimumFare,
      commissionPercent: vt.commissionPercent,
      cancellationTimeLimitMin: vt.cancellationTimeLimitMin,
      cancellationCharge: vt.cancellationCharge,
      waitingTimeLimitMin: vt.waitingTimeLimitMin,
      waitingCharge: vt.waitingCharge,
      inTransitWaitingFeePerMin: vt.inTransitWaitingFeePerMin,
      personCapacity: vt.personCapacity,
      peakSurchargeEnabled: vt.peakSurchargeEnabled,
      peakSurchargeWindows: vt.peakSurchargeWindows ?? [],
      nightChargeEnabled: vt.nightChargeEnabled,
      nightChargeStart: vt.nightChargeStart ?? "22:00",
      nightChargeEnd: vt.nightChargeEnd ?? "06:00",
      nightChargeMultiplier: vt.nightChargeMultiplier,
      displayOrder: vt.displayOrder,
      active: vt.active,
      iconUrl: vt.iconUrl ?? "",
      classKey: vt.classKey ?? "",
      serviceAreaIds: vt.serviceAreaIds ?? [],
    });
    setIconPreviewError(false);
    setUploadError(null);
    setOpen(true);
  };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const togglePool = (checked: boolean) => {
    setForm((f) => ({
      ...f,
      poolEnabled: checked,
      // Forced rule: pool ⇒ fixed
      fareModelStrategy: checked ? "fixed" : f.fareModelStrategy,
    }));
  };

  const toggleArea = (id: string, checked: boolean) => {
    setForm((f) => ({
      ...f,
      serviceAreaIds: checked
        ? Array.from(new Set([...f.serviceAreaIds, id]))
        : f.serviceAreaIds.filter((x) => x !== id),
    }));
  };

  const addPeakWindow = () =>
    setForm((f) => ({
      ...f,
      peakSurchargeWindows: [
        ...f.peakSurchargeWindows,
        { days: [1, 2, 3, 4, 5], startTime: "07:00", endTime: "10:00", multiplier: 1.3 },
      ],
    }));

  const updatePeakWindow = (idx: number, patch: Partial<PeakWindow>) =>
    setForm((f) => ({
      ...f,
      peakSurchargeWindows: f.peakSurchargeWindows.map((w, i) =>
        i === idx ? { ...w, ...patch } : w,
      ),
    }));

  const removePeakWindow = (idx: number) =>
    setForm((f) => ({
      ...f,
      peakSurchargeWindows: f.peakSurchargeWindows.filter((_, i) => i !== idx),
    }));

  const iconPreviewUrl = form.iconUrl.trim();
  const showPreview = iconPreviewUrl.length > 0 && !iconPreviewError;

  const formIsValid =
    form.name.trim().length > 0 &&
    form.iconUrl.trim().length > 0 &&
    form.serviceAreaIds.length > 0 &&
    (!form.poolEnabled || form.fareModelStrategy === "fixed") &&
    (!form.nightChargeEnabled ||
      (!!form.nightChargeStart &&
        !!form.nightChargeEnd &&
        form.nightChargeStart !== form.nightChargeEnd &&
        form.nightChargeMultiplier > 1)) &&
    (!form.peakSurchargeEnabled ||
      (form.peakSurchargeWindows.length > 0 &&
        form.peakSurchargeWindows.every(
          (w) =>
            w.days.length > 0 &&
            new Set(w.days).size === w.days.length &&
            w.startTime < w.endTime &&
            w.multiplier > 1,
        )));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Service Categories</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Pricing tiers, capabilities and availability for ride bidding
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1.5" /> Add Category
        </Button>
      </div>

      <FilterBar
        hasActiveFilters={vtSearch !== "" || vtCategory !== "all"}
        onClear={() => { setVtSearch(""); setVtCategory("all"); setVtPage(1); }}
      >
        <SearchInput
          value={vtSearch}
          onChange={(v) => { setVtSearch(v); setVtPage(1); }}
          placeholder="Search categories…"
          className="sm:w-72"
        />
        <select
          value={vtCategory}
          onChange={(e) => { setVtCategory(e.target.value); setVtPage(1); }}
          className="h-9 rounded-md border border-input bg-background px-3 text-xs"
        >
          <option value="all">All categories</option>
          <option value="car">Car</option>
          <option value="moto">Moto</option>
        </select>
      </FilterBar>

      <DataTable
        columnCount={7}
        isLoading={isLoading}
        empty={
          <EmptyState
            icon={Car}
            title={vtSearch || vtCategory !== "all" ? "No categories match" : "No service categories yet"}
            description={
              vtSearch || vtCategory !== "all"
                ? "Try adjusting your filters."
                : "Add your first category above."
            }
          />
        }
        header={
          <TableRow>
            <TableHead>Icon</TableHead>
            <SortableHeader sortKey="name" sort={vtSort} onSortChange={setVtSort} defaultDirection="asc">Category</SortableHeader>
            <TableHead>Capabilities</TableHead>
            <SortableHeader sortKey="baseFare" sort={vtSort} onSortChange={setVtSort} className="text-right">Base / km / min</SortableHeader>
            <TableHead className="text-right">Comm.</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        }
        footer={
          <DataTablePagination
            page={vtPage}
            setPage={setVtPage}
            total={vtSorted.length}
            pageSize={VT_PAGE_SIZE}
            itemLabel="categories"
          />
        }
      >
        {vtPaged.map((vt) => {
              const incomplete =
                !vt.iconUrl || (vt.serviceAreaIds?.length ?? 0) === 0;
              return (
                <TableRow key={vt.id}>
                  <TableCell>
                    {vt.iconUrl ? (
                      <img
                        src={vt.iconUrl}
                        alt={vt.name}
                        className="w-10 h-10 object-contain rounded"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="flex flex-col items-start gap-1">
                        <div
                          className="w-10 h-10 rounded border border-dashed border-amber-300 bg-amber-50 flex items-center justify-center"
                          title="No icon uploaded — riders see a default icon"
                        >
                          <ImageOff className="w-4 h-4 text-amber-600" />
                        </div>
                        <Badge
                          variant="outline"
                          className="text-[10px] py-0 px-1.5 font-normal border-amber-300 bg-amber-50 text-amber-700"
                        >
                          No icon
                        </Badge>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                      <div className="flex items-center gap-1.5">
                        {vt.vehicleCategory === "moto" ? (
                          <Bike className="w-3.5 h-3.5 text-muted-foreground" />
                        ) : (
                          <Car className="w-3.5 h-3.5 text-muted-foreground" />
                        )}
                        <span className="font-medium">{vt.name}</span>
                        {incomplete && (
                          <span title="Icon or locations missing">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                          </span>
                        )}
                      </div>
                      {vt.description && (
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {vt.description}
                        </div>
                      )}
                      <div className="flex items-center gap-1 mt-1.5">
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal">
                          {vt.fareModelStrategy === "fixed" ? "Fixed" : "Incremental"}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal">
                          {vt.serviceAreaIds?.length ?? 0} loc.
                        </Badge>
                        <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5">
                          <Users className="w-2.5 h-2.5" />
                          {vt.personCapacity}
                        </span>
                        {vt.classKey ? (
                          <Badge
                            className={`text-[10px] py-0 px-1.5 font-normal inline-flex items-center gap-1 ${classKeyColor(vt.classKey)}`}
                            title="App class key used for pricing lookup"
                          >
                            {classColorMap[vt.classKey] && (
                              <span
                                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: classColorMap[vt.classKey]! }}
                              />
                            )}
                            {vt.classKey}
                          </Badge>
                        ) : (
                          <span
                            className="text-[10px] text-muted-foreground italic"
                            title="No class key set — pricing fallback will apply"
                          >
                            no class
                          </span>
                        )}
                      </div>
                  </TableCell>
                  <TableCell className="align-top">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        {vt.poolEnabled && (
                          <span title="Pool / Shared ride" className="text-violet-600">
                            <Users className="w-4 h-4" />
                          </span>
                        )}
                        {vt.wheelchairAccess && (
                          <span title="Wheelchair access" className="text-blue-600">
                            <Accessibility className="w-4 h-4" />
                          </span>
                        )}
                        {vt.assistAvailable && (
                          <span title="Assist available" className="text-emerald-600">
                            <Heart className="w-4 h-4" />
                          </span>
                        )}
                        {vt.petFriendly && (
                          <span title="Pet friendly" className="text-amber-600">
                            <PawPrint className="w-4 h-4" />
                          </span>
                        )}
                        {!vt.poolEnabled &&
                          !vt.wheelchairAccess &&
                          !vt.assistAvailable &&
                          !vt.petFriendly && (
                            <span className="text-xs italic text-muted-foreground/70">
                              none
                            </span>
                          )}
                      </div>
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    <div>{vt.baseFare.toFixed(2)}</div>
                    <div className="text-muted-foreground">
                      {vt.pricePerKm.toFixed(2)} / {vt.pricePerMin.toFixed(2)}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{vt.commissionPercent}%</TableCell>
                  <TableCell>
                    <StatusBadge variant={vt.active ? "success" : "neutral"}>
                      {vt.active ? "Active" : "Inactive"}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(vt)}
                        className="h-7 w-7 p-0"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteTarget(vt)}
                        className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
      </DataTable>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title="Delete service category?"
        description={
          deleteTarget
            ? `“${deleteTarget.name}” will be permanently removed. This cannot be undone.`
            : ""
        }
        confirmLabel={remove.isPending ? "Deleting…" : "Delete"}
        destructive
        loading={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Service Category" : "New Service Category"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-2">
            {/* IDENTITY */}
            <section>
              <h3 className={SECTION_HEADER}>Identity</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label>Name *</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setField("name", e.target.value)}
                    placeholder="e.g. Eco"
                    className="mt-1"
                  />
                </div>
                <div className="col-span-2">
                  <Label>Description</Label>
                  <Input
                    value={form.description}
                    onChange={(e) => setField("description", e.target.value)}
                    placeholder="Short description shown to riders"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Map icon type</Label>
                  <Select
                    value={form.vehicleCategory}
                    onValueChange={(v) => setField("vehicleCategory", v as "car" | "moto")}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="car">Car</SelectItem>
                      <SelectItem value="moto">Moto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>
                    App class key{" "}
                    <span
                      className="text-muted-foreground font-normal"
                      title="A short slug used by the app to identify this category for pricing and matching. Manage class keys in Configuration → Class Keys."
                    >
                      <Info className="w-3.5 h-3.5 inline-block align-text-bottom" />
                    </span>
                  </Label>
                  <Select
                    value={form.classKey || "__none__"}
                    onValueChange={(v) => setField("classKey", v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select a class key…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        <span className="text-muted-foreground italic">None</span>
                      </SelectItem>
                      {appClasses.map((cls) => (
                        <SelectItem key={cls.slug} value={cls.slug}>
                          <div className="flex items-center gap-2">
                            {cls.colorHex && (
                              <span
                                className="w-3 h-3 rounded-full flex-shrink-0 inline-block"
                                style={{ backgroundColor: cls.colorHex }}
                              />
                            )}
                            <span className="font-mono text-xs">{cls.slug}</span>
                            <span className="text-muted-foreground">— {cls.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Manage class keys in Configuration → Class Keys.
                  </p>
                </div>
              </div>

              {/* Icon */}
              <div className="mt-4 rounded-xl border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-semibold text-sm">Vehicle picture *</h4>
                  <span className="text-xs text-muted-foreground">
                    (shown in the rider app)
                  </span>
                  {!showPreview && (
                    <Badge
                      variant="outline"
                      className="text-[10px] py-0 px-1.5 font-normal border-amber-300 bg-amber-50 text-amber-700"
                    >
                      No icon — riders see a default
                    </Badge>
                  )}
                </div>
                {editing && !editing.iconUrl && !form.iconUrl.trim() && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span>
                      No icon uploaded yet. A default vector icon is shown to riders
                      until you upload branded artwork.
                    </span>
                  </div>
                )}
                <div className="flex gap-3 items-start">
                  <div className="w-16 h-16 rounded-xl border bg-background flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {isUploading ? (
                      <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                    ) : showPreview ? (
                      <img
                        src={iconPreviewUrl}
                        alt="Icon preview"
                        className="w-full h-full object-contain p-1"
                        onError={() => setIconPreviewError(true)}
                        onLoad={() => setIconPreviewError(false)}
                      />
                    ) : (
                      <ImageOff className="w-6 h-6 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ACCEPTED_IMAGE_TYPES.join(",")}
                      className="hidden"
                      onChange={(e) => {
                        handleFile(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (!isUploading) setIsDragging(true);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        setIsDragging(false);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDragging(false);
                        if (isUploading) return;
                        handleFile(e.dataTransfer.files?.[0]);
                      }}
                      disabled={isUploading}
                      className={`w-full rounded-lg border-2 border-dashed px-3 py-3 text-xs flex items-center justify-center gap-2 transition-colors ${
                        isDragging
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-muted-foreground/30 bg-background hover:bg-muted/40 text-muted-foreground"
                      } ${isUploading ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                      aria-label="Upload vehicle picture"
                    >
                      {isUploading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Uploading… {uploadProgress}%</span>
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4" />
                          <span>
                            Drag &amp; drop an image, or{" "}
                            <span className="underline">click to browse</span>
                          </span>
                        </>
                      )}
                    </button>
                    {uploadError && (
                      <p className="text-xs text-destructive">{uploadError}</p>
                    )}
                  </div>
                </div>

                {/* URL fallback */}
                <details className="group rounded-lg border bg-background px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground select-none flex items-center justify-between">
                    <span>Or paste an image URL</span>
                    <span className="text-[10px] text-muted-foreground/70 group-open:hidden">
                      advanced
                    </span>
                  </summary>
                  <div className="mt-2 space-y-1.5">
                    <Label className="text-xs">Icon URL</Label>
                    <Input
                      value={form.iconUrl}
                      onChange={(e) => {
                        setField("iconUrl", e.target.value);
                        setIconPreviewError(false);
                      }}
                      placeholder="https://example.com/car-icon.png"
                      className="text-xs"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Use this if you already host the image on a public CDN.
                    </p>
                  </div>
                </details>

                <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2.5 text-xs text-blue-700">
                  <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <div className="space-y-0.5">
                    <div className="font-semibold">Recommendations</div>
                    <ul className="list-disc list-inside space-y-0.5 text-blue-600">
                      <li><strong>Size:</strong> 128 × 128 px minimum (256 × 256 px ideal)</li>
                      <li><strong>Format:</strong> PNG or WebP with transparent background</li>
                      <li><strong>Style:</strong> Top-down or 3/4 view of the vehicle</li>
                      <li>Max 5 MB.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </section>

            {/* CAPABILITIES */}
            <section>
              <h3 className={SECTION_HEADER}>Capabilities</h3>
              <div className="grid grid-cols-2 gap-y-3 gap-x-6 rounded-lg border p-3">
                <ToggleRow
                  icon={<Users className="w-4 h-4 text-violet-600" />}
                  label="Enable Pool / Shared ride"
                  checked={form.poolEnabled}
                  onChange={togglePool}
                />
                <ToggleRow
                  icon={<Accessibility className="w-4 h-4 text-blue-600" />}
                  label="Wheelchair access available"
                  checked={form.wheelchairAccess}
                  onChange={(v) => setField("wheelchairAccess", v)}
                />
                <ToggleRow
                  icon={<Heart className="w-4 h-4 text-emerald-600" />}
                  label="Assist available"
                  checked={form.assistAvailable}
                  onChange={(v) => setField("assistAvailable", v)}
                />
                <ToggleRow
                  icon={<PawPrint className="w-4 h-4 text-amber-600" />}
                  label="Pet friendly"
                  checked={form.petFriendly}
                  onChange={(v) => setField("petFriendly", v)}
                />
              </div>
            </section>

            {/* FARE MODEL & LOCATIONS */}
            <section>
              <h3 className={SECTION_HEADER}>Fare model & locations</h3>
              <div className="space-y-3">
                <div>
                  <Label>Fare model strategy</Label>
                  <Select
                    value={form.fareModelStrategy}
                    onValueChange={(v) =>
                      setField("fareModelStrategy", v as "incremental" | "fixed")
                    }
                    disabled={form.poolEnabled}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="incremental" disabled={form.poolEnabled}>
                        Incremental
                      </SelectItem>
                      <SelectItem value="fixed">Fixed</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.poolEnabled && (
                    <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1.5">
                      <Info className="w-3 h-3" />
                      Pool rides require a fixed fare model.
                    </p>
                  )}
                </div>

                <div>
                  <Label>Locations *</Label>
                  <p className="text-xs text-muted-foreground mb-1.5">
                    Where this category is offered. Manage areas in Service Areas.
                  </p>
                  {serviceAreas.length === 0 ? (
                    <p className="text-xs text-amber-600 border border-amber-200 bg-amber-50 rounded p-2">
                      No service areas defined yet. Create one first.
                    </p>
                  ) : (
                    <div className="rounded-lg border max-h-40 overflow-y-auto p-2 space-y-1">
                      {serviceAreas.map((a) => {
                        const checked = form.serviceAreaIds.includes(a.id);
                        return (
                          <label
                            key={a.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/40 cursor-pointer text-sm"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => toggleArea(a.id, !!v)}
                            />
                            <span className="flex-1">{a.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {a.country}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {form.serviceAreaIds.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {form.serviceAreaIds.map((id) => (
                        <Badge key={id} variant="secondary" className="text-xs">
                          {serviceAreaMap[id]?.name ?? id.slice(0, 6)}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* PRICING */}
            <section>
              <h3 className={SECTION_HEADER}>Pricing (MAD)</h3>
              <div className="grid grid-cols-2 gap-3">
                <NumField
                  label="Price per km"
                  value={form.pricePerKm}
                  onChange={(v) => setField("pricePerKm", v)}
                />
                <NumField
                  label="Price per min"
                  value={form.pricePerMin}
                  onChange={(v) => setField("pricePerMin", v)}
                />
                <NumField
                  label="Base fare"
                  value={form.baseFare}
                  onChange={(v) => setField("baseFare", v)}
                />
                <NumField
                  label="Minimum fare"
                  value={form.minimumFare}
                  onChange={(v) => setField("minimumFare", v)}
                />
                <NumField
                  label="Commission %"
                  value={form.commissionPercent}
                  onChange={(v) => setField("commissionPercent", v)}
                />
                <NumField
                  label="Person capacity"
                  value={form.personCapacity}
                  onChange={(v) => setField("personCapacity", v)}
                  step="1"
                />
              </div>
            </section>

            {/* CANCELLATION & WAITING */}
            <section>
              <h3 className={SECTION_HEADER}>Cancellation & waiting</h3>
              <div className="grid grid-cols-2 gap-3">
                <NumField
                  label="User cancellation time limit (min)"
                  value={form.cancellationTimeLimitMin}
                  onChange={(v) => setField("cancellationTimeLimitMin", v)}
                  step="1"
                />
                <NumField
                  label="User cancellation charge (MAD)"
                  value={form.cancellationCharge}
                  onChange={(v) => setField("cancellationCharge", v)}
                />
                <NumField
                  label="Waiting time limit (min)"
                  value={form.waitingTimeLimitMin}
                  onChange={(v) => setField("waitingTimeLimitMin", v)}
                  step="1"
                />
                <NumField
                  label="Waiting charge (MAD, flat)"
                  value={form.waitingCharge}
                  onChange={(v) => setField("waitingCharge", v)}
                />
                <div className="col-span-2">
                  <NumField
                    label="In-transit waiting fee per minute (MAD, rounded up)"
                    value={form.inTransitWaitingFeePerMin}
                    onChange={(v) => setField("inTransitWaitingFeePerMin", v)}
                  />
                </div>
              </div>
            </section>

            {/* PEAK / NIGHT */}
            <section>
              <h3 className={SECTION_HEADER}>Peak & night surcharges</h3>

              {/* Peak */}
              <div className="rounded-lg border p-3 mb-3">
                <div className="flex items-center justify-between">
                  <Label className="font-medium">Peak time surcharge</Label>
                  <Switch
                    checked={form.peakSurchargeEnabled}
                    onCheckedChange={(v) => setField("peakSurchargeEnabled", v)}
                  />
                </div>
                {form.peakSurchargeEnabled && (
                  <div className="mt-3 space-y-3">
                    {form.peakSurchargeWindows.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        No windows yet. Add at least one window.
                      </p>
                    )}
                    {form.peakSurchargeWindows.map((w, idx) => (
                      <div
                        key={idx}
                        className="rounded-md border bg-muted/20 p-3 space-y-2 relative"
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removePeakWindow(idx)}
                          className="absolute top-1 right-1 h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                        <div>
                          <Label className="text-xs">Days</Label>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {DAY_LABELS.map((d, di) => {
                              const active = w.days.includes(di);
                              return (
                                <button
                                  key={di}
                                  type="button"
                                  onClick={() =>
                                    updatePeakWindow(idx, {
                                      days: active
                                        ? w.days.filter((x) => x !== di)
                                        : [...w.days, di].sort(),
                                    })
                                  }
                                  className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${
                                    active
                                      ? "bg-primary text-primary-foreground border-primary"
                                      : "bg-background text-foreground hover:bg-muted"
                                  }`}
                                >
                                  {d}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <Label className="text-xs">Start</Label>
                            <Input
                              type="time"
                              value={w.startTime}
                              onChange={(e) =>
                                updatePeakWindow(idx, { startTime: e.target.value })
                              }
                              className="mt-1"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">End</Label>
                            <Input
                              type="time"
                              value={w.endTime}
                              onChange={(e) =>
                                updatePeakWindow(idx, { endTime: e.target.value })
                              }
                              className="mt-1"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Multiplier</Label>
                            <Input
                              type="number"
                              step="0.05"
                              min="1.01"
                              value={w.multiplier}
                              onChange={(e) =>
                                updatePeakWindow(idx, {
                                  multiplier: Number(e.target.value),
                                })
                              }
                              className="mt-1"
                            />
                          </div>
                        </div>
                        {(w.startTime >= w.endTime ||
                          w.days.length === 0 ||
                          new Set(w.days).size !== w.days.length ||
                          w.multiplier <= 1) && (
                          <p className="mt-2 text-xs text-rose-600">
                            {w.days.length === 0
                              ? "Pick at least one day."
                              : new Set(w.days).size !== w.days.length
                                ? "Each day can only appear once."
                                : w.startTime >= w.endTime
                                  ? "End time must be after start time. Use night charges for overnight windows."
                                  : "Multiplier must be greater than 1."}
                          </p>
                        )}
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={addPeakWindow}
                      className="w-full"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1.5" /> Add peak window
                    </Button>
                  </div>
                )}
              </div>

              {/* Night */}
              <div className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <Label className="font-medium">Night charges</Label>
                  <Switch
                    checked={form.nightChargeEnabled}
                    onCheckedChange={(v) => setField("nightChargeEnabled", v)}
                  />
                </div>
                {form.nightChargeEnabled && (
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <div>
                      <Label className="text-xs">Start</Label>
                      <Input
                        type="time"
                        value={form.nightChargeStart}
                        onChange={(e) => setField("nightChargeStart", e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">End</Label>
                      <Input
                        type="time"
                        value={form.nightChargeEnd}
                        onChange={(e) => setField("nightChargeEnd", e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Multiplier</Label>
                      <Input
                        type="number"
                        step="0.05"
                        min="1.01"
                        value={form.nightChargeMultiplier}
                        onChange={(e) =>
                          setField("nightChargeMultiplier", Number(e.target.value))
                        }
                        className="mt-1"
                      />
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* DISPLAY */}
            <section>
              <h3 className={SECTION_HEADER}>Display</h3>
              <div className="grid grid-cols-2 gap-3">
                <NumField
                  label="Order in app list"
                  value={form.displayOrder}
                  onChange={(v) => setField("displayOrder", v)}
                  step="1"
                />
                <div className="flex items-end gap-3 pb-1">
                  <Switch
                    checked={form.active}
                    onCheckedChange={(v) => setField("active", v)}
                  />
                  <Label>Active</Label>
                </div>
              </div>
            </section>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => save.mutate(form)}
              disabled={save.isPending || !formIsValid}
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer">
      <span className="flex items-center gap-2 text-sm">
        {icon}
        {label}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function NumField({
  label,
  value,
  onChange,
  step = "0.01",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: string;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1"
        step={step}
        min="0"
      />
    </div>
  );
}
