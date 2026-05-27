import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Lang = "en" | "fr" | "ar";

interface PageRow {
  slug: string;
  lang: Lang;
  title: string;
  status: "draft" | "published";
  updatedAt: string;
}

export default function WebsitePagesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-site-pages"],
    queryFn: () => api<{ pages: PageRow[] }>("/admin/site/pages").then((r) => r.pages),
  });

  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [titleFr, setTitleFr] = useState("");
  const [titleAr, setTitleAr] = useState("");
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "published">("all");

  const onCreate = async () => {
    const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!cleanSlug || !titleEn || !titleFr || !titleAr) {
      toast.error("Slug and all three titles are required.");
      return;
    }
    setCreating(true);
    try {
      const base = {
        slug: cleanSlug,
        status: "draft" as const,
        content: { heading: "", subheading: "", blocks: [] },
        twitterCard: "summary_large_image" as const,
        robotsIndex: true,
      };
      await api("/admin/site/pages", { method: "POST", json: { ...base, lang: "en", title: titleEn } });
      await api("/admin/site/pages", { method: "POST", json: { ...base, lang: "fr", title: titleFr } });
      await api("/admin/site/pages", { method: "POST", json: { ...base, lang: "ar", title: titleAr } });
      toast.success("Page created");
      setSlug(""); setTitleEn(""); setTitleFr(""); setTitleAr(""); setOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-site-pages"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const onDelete = async (s: string) => {
    if (!confirm(`Delete page "${s}" (EN, FR and AR)?`)) return;
    try {
      await api(`/admin/site/pages/${s}/en`, { method: "DELETE" }).catch(() => {});
      await api(`/admin/site/pages/${s}/fr`, { method: "DELETE" }).catch(() => {});
      await api(`/admin/site/pages/${s}/ar`, { method: "DELETE" }).catch(() => {});
      toast.success("Page deleted");
      qc.invalidateQueries({ queryKey: ["admin-site-pages"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const grouped = (() => {
    const m = new Map<string, { en?: PageRow; fr?: PageRow; ar?: PageRow }>();
    (data ?? []).forEach((p) => {
      const cur = m.get(p.slug) ?? {};
      cur[p.lang] = p;
      m.set(p.slug, cur);
    });
    const q = search.trim().toLowerCase();
    return Array.from(m.entries())
      .filter(([slug, langs]) => {
        if (statusFilter !== "all") {
          const matches =
            (langs.en && langs.en.status === statusFilter) ||
            (langs.fr && langs.fr.status === statusFilter) ||
            (langs.ar && langs.ar.status === statusFilter);
          if (!matches) return false;
        }
        if (!q) return true;
        return (
          slug.toLowerCase().includes(q) ||
          (langs.en?.title || "").toLowerCase().includes(q) ||
          (langs.fr?.title || "").toLowerCase().includes(q) ||
          (langs.ar?.title || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a[0].localeCompare(b[0]));
  })();

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Website Pages</h1>
          <p className="text-sm text-muted-foreground">Manage marketing site content and SEO for English and French.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-1" /> New page</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create a new page</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Slug</Label>
                <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="e.g. drivers-guide" />
                <p className="text-xs text-muted-foreground mt-1">Lowercase letters, numbers, dashes only.</p>
              </div>
              <div>
                <Label>English title</Label>
                <Input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
              </div>
              <div>
                <Label>French title</Label>
                <Input value={titleFr} onChange={(e) => setTitleFr(e.target.value)} />
              </div>
              <div>
                <Label>Arabic title</Label>
                <Input value={titleAr} onChange={(e) => setTitleAr(e.target.value)} dir="rtl" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={onCreate} disabled={creating}>{creating ? "Creating…" : "Create"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by slug or title…"
          className="max-w-xs"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | "draft" | "published")}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
        {(search || statusFilter !== "all") && (
          <button
            type="button"
            onClick={() => { setSearch(""); setStatusFilter("all"); }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">{grouped.length} page{grouped.length === 1 ? "" : "s"}</span>
      </div>
      {isLoading ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 font-medium">English</th>
                <th className="px-4 py-3 font-medium">French</th>
                <th className="px-4 py-3 font-medium">Arabic</th>
                <th className="px-4 py-3 font-medium">Last updated</th>
                <th className="px-4 py-3 font-medium w-10"></th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(([slug, langs]) => {
                const newest = [langs.en?.updatedAt, langs.fr?.updatedAt].filter(Boolean).sort().pop();
                return (
                  <tr key={slug} className="border-t border-border">
                    <td className="px-4 py-3 font-mono text-xs">{slug}</td>
                    <td className="px-4 py-3">
                      {langs.en ? (
                        <Link href={`/website/pages/${slug}/en`} className="text-primary hover:underline">
                          {langs.en.title} <span className="text-xs text-muted-foreground">({langs.en.status})</span>
                        </Link>
                      ) : (
                        <Link href={`/website/pages/${slug}/en`} className="text-muted-foreground hover:underline">— create —</Link>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {langs.fr ? (
                        <Link href={`/website/pages/${slug}/fr`} className="text-primary hover:underline">
                          {langs.fr.title} <span className="text-xs text-muted-foreground">({langs.fr.status})</span>
                        </Link>
                      ) : (
                        <Link href={`/website/pages/${slug}/fr`} className="text-muted-foreground hover:underline">— create —</Link>
                      )}
                    </td>
                    <td className="px-4 py-3" dir="rtl">
                      {langs.ar ? (
                        <Link href={`/website/pages/${slug}/ar`} className="text-primary hover:underline">
                          {langs.ar.title} <span className="text-xs text-muted-foreground">({langs.ar.status})</span>
                        </Link>
                      ) : (
                        <Link href={`/website/pages/${slug}/ar`} className="text-muted-foreground hover:underline">— create —</Link>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{newest ? new Date(newest).toLocaleString() : "—"}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => onDelete(slug)} className="text-muted-foreground hover:text-destructive" title="Delete page">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
