import { useRef, useState } from "react";
import { Upload, Loader2, X } from "lucide-react";
import { api } from "@/lib/api";

interface Props {
  value: string;
  onChange: (url: string) => void;
  label?: string;
  accept?: string;
  acceptTypes?: string[];
  maxBytes?: number;
}

export function ImagePicker({ value, onChange, label, accept, acceptTypes, maxBytes }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function uploadFile(file: File) {
    setError(null);
    if (acceptTypes && acceptTypes.length > 0 && !acceptTypes.includes(file.type)) {
      setError(`Unsupported file type. Allowed: ${acceptTypes.join(", ")}`);
      return;
    }
    if (maxBytes && file.size > maxBytes) {
      const mb = (maxBytes / (1024 * 1024)).toFixed(0);
      setError(`File too large. Max ${mb}MB.`);
      return;
    }
    setUploading(true);
    try {
      const { uploadURL, objectPath, publicUrl } = await api<{
        uploadURL: string;
        objectPath: string;
        publicUrl?: string;
      }>("/storage/uploads/request-url", {
        method: "POST",
        json: { name: file.name, size: file.size, contentType: file.type || "application/octet-stream" },
      });
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!putRes.ok) throw new Error("Upload failed");
      const finalized = await api<{ publicUrl?: string }>("/storage/uploads/finalize", {
        method: "POST",
        json: { objectPath },
      });
      onChange(finalized.publicUrl || publicUrl || objectPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-1.5">
      {label && <label className="text-xs font-medium">{label}</label>}
      <div className="flex items-start gap-3">
        {value ? (
          <div className="relative w-24 h-24 rounded border border-border overflow-hidden bg-muted shrink-0">
            <img src={value} alt="" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => onChange("")}
              className="absolute top-1 right-1 bg-background/90 rounded-full p-0.5 hover:bg-background"
              aria-label="Remove image"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div className="w-24 h-24 rounded border border-dashed border-border bg-muted/50 shrink-0" />
        )}
        <div className="flex-1 space-y-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-background hover:bg-muted text-xs disabled:opacity-50"
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {uploading ? "Uploading…" : value ? "Replace" : "Upload"}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept={accept ?? "image/*"}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadFile(f);
                e.target.value = "";
              }}
            />
          </div>
          <input
            type="text"
            placeholder="Or paste an image URL"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-2 py-1.5 text-xs rounded border border-input bg-background"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  );
}
