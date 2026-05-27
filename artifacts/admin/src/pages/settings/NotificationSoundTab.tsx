import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import {
  Save,
  RefreshCw,
  Loader2,
  Play,
  Square,
  Upload,
  Trash2,
  Pencil,
  Check,
  X,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import type { TabSettingsResponse } from "./types";

interface PresetOption {
  value: string;
  label: string;
  preview: { frequency: number; durationMs: number; pattern: number[] };
}

const PRESETS: PresetOption[] = [
  { value: "default", label: "Default (system)", preview: { frequency: 660, durationMs: 200, pattern: [200] } },
  { value: "chime",   label: "Chime",   preview: { frequency: 880, durationMs: 350, pattern: [180, 80, 180] } },
  { value: "ping",    label: "Ping",    preview: { frequency: 1320, durationMs: 120, pattern: [120] } },
  { value: "ringtone",label: "Ringtone",preview: { frequency: 540, durationMs: 600, pattern: [200, 80, 200, 80, 200] } },
  { value: "alert",   label: "Alert",   preview: { frequency: 440, durationMs: 250, pattern: [120, 60, 120, 60, 120] } },
  { value: "horn",    label: "Horn",    preview: { frequency: 220, durationMs: 500, pattern: [500] } },
];

const FIELDS: { key: string; label: string; help?: string }[] = [
  { key: "soundNewTripRequest", label: "New trip request", help: "Plays on the driver app when a new ride request arrives." },
  { key: "soundDriverApp", label: "Driver app — general notifications" },
  { key: "soundUserApp", label: "User app — general notifications" },
  { key: "soundVoipCalling", label: "VOIP calling", help: "Plays for in-app voice calls between rider and driver." },
];

const ALLOWED_AUDIO_MIME = [
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave",
  "audio/m4a", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/x-caf", "audio/ogg",
];
const MAX_BYTES = 1024 * 1024;

interface UploadedSound {
  id: string;
  slug: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  url: string;
  createdAt: string;
  inCurrentBuild: boolean;
}

interface SoundsListResponse {
  sounds: UploadedSound[];
  build: { manifestHash: string | null; currentManifestHash: string; upToDate: boolean };
  reservedSlugs: string[];
}

type Values = Record<string, string>;

function usePreviewPlayer() {
  const ctxRef = useRef<AudioContext | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => () => {
    stopRef.current?.();
    ctxRef.current?.close().catch(() => {});
  }, []);

  const stop = () => {
    stopRef.current?.();
    stopRef.current = null;
    setPlaying(null);
  };

  const play = (id: string, sound: PresetOption["preview"]) => {
    stop();
    type AC = typeof AudioContext;
    const Ctx: AC | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AC }).webkitAudioContext;
    if (!Ctx) {
      toast({ title: "Audio preview not supported in this browser", variant: "destructive" });
      return;
    }
    const ctx = ctxRef.current ?? new Ctx();
    ctxRef.current = ctx;
    if (ctx.state === "suspended") ctx.resume();
    let t = ctx.currentTime;
    const nodes: { osc: OscillatorNode; gain: GainNode }[] = [];
    sound.pattern.forEach((ms, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = sound.frequency * (1 + i * 0.05);
      osc.type = "sine";
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.01);
      gain.gain.linearRampToValueAtTime(0, t + ms / 1000);
      osc.start(t);
      osc.stop(t + ms / 1000);
      nodes.push({ osc, gain });
      t += ms / 1000 + 0.05;
    });
    setPlaying(id);
    const totalMs = sound.pattern.reduce((s, n) => s + n + 50, 0);
    const timer = window.setTimeout(() => {
      setPlaying((cur) => (cur === id ? null : cur));
      stopRef.current = null;
    }, totalMs + 100);
    stopRef.current = () => {
      window.clearTimeout(timer);
      nodes.forEach(({ osc }) => {
        try { osc.stop(); } catch { /* already stopped */ }
      });
    };
  };

  return { play, stop, playing };
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || `sound-${Date.now().toString(36)}`;
}

export function NotificationSoundTab() {
  const qc = useQueryClient();
  const queryKey = ["/admin/settings/notificationSound"] as const;
  const libraryKey = ["/admin/notification-sounds"] as const;

  const { data, isLoading, refetch, isFetching } = useQuery<TabSettingsResponse>({
    queryKey,
    queryFn: () => api<TabSettingsResponse>("/admin/settings/notificationSound"),
  });

  const { data: library, refetch: refetchLib } = useQuery<SoundsListResponse>({
    queryKey: libraryKey,
    queryFn: () => api<SoundsListResponse>("/admin/notification-sounds"),
  });

  const [values, setValues] = useState<Values>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingSlug, setPlayingSlug] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const { play, stop, playing } = usePreviewPlayer();

  useEffect(() => {
    if (!data) return;
    const init: Values = {};
    for (const f of FIELDS) init[f.key] = String(data.settings[f.key] ?? "default");
    setValues(init);
  }, [data]);

  const save = useMutation({
    mutationFn: (body: Values) =>
      api<TabSettingsResponse>("/admin/settings/notificationSound", {
        method: "PUT",
        json: body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast({ title: "Notification sounds saved" });
    },
    onError: (err: Error) =>
      toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!ALLOWED_AUDIO_MIME.includes(file.type.toLowerCase())) {
        throw new Error("Unsupported audio format. Use mp3, wav, m4a, aac, caf, or ogg.");
      }
      if (file.size > MAX_BYTES) {
        throw new Error(`File too large. Max ${(MAX_BYTES / 1024).toFixed(0)} KB.`);
      }
      const buf = await file.arrayBuffer();
      const checksum = await sha256Hex(buf);
      const { uploadURL, objectPath } = await api<{ uploadURL: string; objectPath: string }>(
        "/admin/notification-sounds/upload-url",
        { method: "POST", json: { name: file.name, size: file.size, contentType: file.type } },
      );
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: buf,
      });
      if (!putRes.ok) throw new Error(`Upload failed (HTTP ${putRes.status})`);
      const slug = slugify(file.name);
      const displayName = file.name.replace(/\.[a-z0-9]+$/i, "");
      await api("/admin/notification-sounds/finalize", {
        method: "POST",
        json: {
          objectPath,
          slug,
          displayName,
          mimeType: file.type,
          sizeBytes: file.size,
          checksum,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: libraryKey });
      toast({ title: "Sound uploaded" });
    },
    onError: (err: Error) =>
      toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  const renameMut = useMutation({
    mutationFn: ({ id, displayName }: { id: string; displayName: string }) =>
      api(`/admin/notification-sounds/${id}`, { method: "PATCH", json: { displayName } }),
    onSuccess: () => {
      setRenamingId(null);
      qc.invalidateQueries({ queryKey: libraryKey });
    },
    onError: (err: Error) =>
      toast({ title: "Rename failed", description: err.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      api(`/admin/notification-sounds/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: libraryKey });
      toast({ title: "Sound deleted" });
    },
    onError: (err: Error & { data?: { error?: string; inUseFor?: string[] } }) => {
      const msg = err.data?.inUseFor?.length
        ? `Currently assigned to: ${err.data.inUseFor.join(", ")}. Reassign before deleting.`
        : err.message;
      toast({ title: "Delete failed", description: msg, variant: "destructive" });
    },
  });

  const previewById = useMemo(() => {
    const m: Record<string, PresetOption["preview"]> = {};
    for (const s of PRESETS) m[s.value] = s.preview;
    return m;
  }, []);

  const inBuildBySlug = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const s of library?.sounds ?? []) m[s.slug] = s.inCurrentBuild;
    return m;
  }, [library?.sounds]);

  function previewUploaded(slug: string, url: string) {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (playingSlug === slug) {
      setPlayingSlug(null);
      return;
    }
    const audio = new Audio(url.startsWith("http") ? url : `${API_BASE.replace(/\/api$/, "")}${url}`);
    audio.onended = () => setPlayingSlug(null);
    audio.onerror = () => {
      setPlayingSlug(null);
      toast({ title: "Could not play sound", variant: "destructive" });
    };
    audioRef.current = audio;
    audio.play().catch(() => setPlayingSlug(null));
    setPlayingSlug(slug);
  }

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  const sounds = library?.sounds ?? [];
  const reservedSlugs = new Set(library?.reservedSlugs ?? []);
  const buildHash = library?.build?.manifestHash ?? null;
  const currentHash = library?.build?.currentManifestHash ?? "";

  // Build the dropdown options: "Default" + uploaded sounds + system presets.
  const allSelectOptions: { value: string; label: string; uploaded: boolean }[] = [
    { value: "default", label: "Default (system)", uploaded: false },
    ...sounds.map((s) => ({ value: s.slug, label: s.displayName, uploaded: true })),
    ...PRESETS.filter((p) => p.value !== "default").map((p) => ({
      value: p.value,
      label: `${p.label} (preset)`,
      uploaded: false,
    })),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Sound library</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Upload custom audio files (mp3, wav, m4a, aac, caf, ogg, ≤ 1 MB) and assign them
          to the four notification categories below. Uploaded sounds play in-app
          immediately. For OS-level push playback while the app is backgrounded, the
          sound must also be present in the latest mobile build — run{" "}
          <code className="px-1 py-0.5 rounded bg-muted text-[11px]">pnpm --filter biddi run sync-sounds</code>{" "}
          and ship a new EAS build.
        </p>
      </div>

      <div
        className={`rounded-lg border p-3 space-y-3 transition-colors ${
          isDragging ? "border-primary bg-primary/5" : "border-border"
        }`}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setIsDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setIsDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) upload.mutate(f);
        }}
        data-testid="upload-sound-dropzone"
      >
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = "";
            }}
            data-testid="upload-sound-input"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={upload.isPending}
            data-testid="upload-sound-button"
          >
            {upload.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Upload className="w-4 h-4 mr-2" />
            )}
            Upload sound
          </Button>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            or drag and drop an audio file here
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => refetchLib()}
            title="Refresh library"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
          <div className="ml-auto text-xs text-muted-foreground">
            {buildHash === null ? (
              <span className="inline-flex items-center gap-1 text-amber-600">
                <AlertTriangle className="w-3.5 h-3.5" /> No mobile build hash recorded yet.
              </span>
            ) : buildHash === currentHash ? (
              <span className="inline-flex items-center gap-1 text-emerald-600">
                <CheckCircle2 className="w-3.5 h-3.5" /> Library matches the current mobile build.
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-600">
                <AlertTriangle className="w-3.5 h-3.5" /> Library has changed since the last mobile build — push sounds will fall back to default.
              </span>
            )}
          </div>
        </div>

        {sounds.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">
            No uploaded sounds yet. Use the system presets below or upload your first audio file.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {sounds.map((s) => {
              const isInBuild = s.inCurrentBuild;
              return (
                <li key={s.id} className="py-2 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => previewUploaded(s.slug, s.url)}
                    aria-label={playingSlug === s.slug ? "Stop" : "Play"}
                  >
                    {playingSlug === s.slug ? (
                      <Square className="w-4 h-4" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                  </Button>
                  <div className="flex-1 min-w-0">
                    {renamingId === s.id ? (
                      <div className="flex items-center gap-1">
                        <Input
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          className="h-7 text-xs"
                          autoFocus
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            renameMut.mutate({ id: s.id, displayName: renameDraft.trim() || s.displayName })
                          }
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setRenamingId(null)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="text-sm truncate">{s.displayName}</div>
                        <div className="text-[11px] text-muted-foreground">
                          slug: {s.slug} · {(s.sizeBytes / 1024).toFixed(1)} KB ·{" "}
                          {isInBuild ? (
                            <span className="text-emerald-600">in current mobile build</span>
                          ) : (
                            <span className="text-amber-600">
                              not yet in mobile build — will play default until next release
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  {renamingId !== s.id && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRenamingId(s.id);
                          setRenameDraft(s.displayName);
                        }}
                        aria-label="Rename"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm(`Delete "${s.displayName}"?`)) deleteMut.mutate(s.id);
                        }}
                        aria-label="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-foreground">Category assignment</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Pick a sound for each notification category. The bundled system presets remain
          available as fallbacks.
        </p>
      </div>

      <div className="space-y-3">
        {FIELDS.map((f) => {
          const value = values[f.key] ?? "default";
          const id = `f-${f.key}`;
          const isPlaying = playing === f.key;
          const uploadedMatch = sounds.find((s) => s.slug === value);
          const presetMatch = previewById[value];
          return (
            <div key={f.key} className="rounded-lg border border-border p-3">
              <Label htmlFor={id}>{f.label}</Label>
              <div className="mt-1 flex items-center gap-2">
                <Select
                  value={value}
                  onValueChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
                >
                  <SelectTrigger id={id} className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allSelectOptions.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (uploadedMatch) {
                      previewUploaded(uploadedMatch.slug, uploadedMatch.url);
                    } else if (presetMatch) {
                      if (isPlaying) stop();
                      else play(f.key, presetMatch);
                    }
                  }}
                  aria-label={isPlaying ? "Stop preview" : "Play preview"}
                  data-testid={`preview-${f.key}`}
                >
                  {(isPlaying || playingSlug === uploadedMatch?.slug) ? (
                    <>
                      <Square className="w-4 h-4 mr-1" /> Stop
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-1" /> Preview
                    </>
                  )}
                </Button>
              </div>
              {uploadedMatch &&
                !reservedSlugs.has(uploadedMatch.slug) &&
                !inBuildBySlug[uploadedMatch.slug] && (
                  <p className="text-[11px] text-amber-600 mt-2 inline-flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Will play default in push notifications until the next mobile build.
                  </p>
                )}
              {f.help && <p className="text-xs text-muted-foreground mt-2">{f.help}</p>}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Browser previews of system presets are an approximation generated with WebAudio.
        Uploaded sounds play the actual file. The OS push-notification sound is taken
        from the bundled mobile app — re-run{" "}
        <code className="px-1 py-0.5 rounded bg-muted text-[11px]">pnpm --filter biddi run sync-sounds</code>{" "}
        and ship a new build to update it.
      </p>

      <div className="flex flex-wrap items-center gap-3 pt-4 border-t">
        <Button onClick={() => save.mutate(values)} disabled={save.isPending}>
          {save.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Save changes
        </Button>
        <Button
          variant="outline"
          onClick={() => refetch()}
          disabled={isFetching || save.isPending}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Reset
        </Button>
      </div>
    </div>
  );
}
