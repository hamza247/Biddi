import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ChevronLeft, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { RichTextEditor } from "@/components/RichTextEditor";
import { ImagePicker } from "@/components/ImagePicker";

type PageStatus = "draft" | "published";
type TwitterCard = "summary" | "summary_large_image";
type Lang = "en" | "fr" | "ar";
type BlockItem = Record<string, unknown>;
interface Block {
  type: string;
  title?: string;
  subtitle?: string;
  image?: string;
  src?: string;
  alt?: string;
  caption?: string;
  ctaLabel?: string;
  ctaHref?: string;
  html?: string;
  items?: BlockItem[];
}

interface SitePage {
  slug: string;
  lang: Lang;
  status: PageStatus;
  title: string;
  content: { heading?: string; subheading?: string; blocks: Block[] };
  metaTitle: string | null;
  metaDescription: string | null;
  metaKeywords: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  twitterCard: TwitterCard;
  canonicalUrl: string | null;
  robotsIndex: boolean;
}

const EMPTY: SitePage = {
  slug: "", lang: "en", status: "published", title: "",
  content: { heading: "", subheading: "", blocks: [] },
  metaTitle: "", metaDescription: "", metaKeywords: "",
  ogTitle: "", ogDescription: "", ogImage: "",
  twitterCard: "summary_large_image", canonicalUrl: "", robotsIndex: true,
};

const BLOCK_TYPES = ["hero", "features", "steps", "testimonials", "faq", "richtext", "cta", "image"] as const;

function newBlock(type: string): Block {
  switch (type) {
    case "hero": return { type, title: "", subtitle: "", image: "", ctaLabel: "", ctaHref: "" };
    case "features": return { type, title: "Features", items: [{ icon: "", title: "", description: "" }] };
    case "steps": return { type, title: "How it works", items: [{ title: "", description: "" }] };
    case "testimonials": return { type, title: "Testimonials", items: [{ name: "", role: "", quote: "", rating: 5 }] };
    case "faq": return { type, title: "FAQ", items: [{ question: "", answer: "" }] };
    case "richtext": return { type, title: "", html: "<p></p>" };
    case "cta": return { type, title: "", subtitle: "", ctaLabel: "Get started", ctaHref: "/" };
    case "image": return { type, src: "", alt: "", caption: "" };
    default: return { type };
  }
}

export default function WebsitePageEditor() {
  const params = useParams<{ slug: string; lang: Lang }>();
  const [, setLocation] = useLocation();
  const slug = params.slug;
  const lang = params.lang;
  const { data, isLoading } = useQuery({
    queryKey: ["admin-site-page", slug, lang],
    queryFn: async () => {
      try {
        return await api<{ page: SitePage }>(`/admin/site/pages/${slug}/${lang}`).then((r) => r.page);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return { ...EMPTY, slug, lang };
        throw e;
      }
    },
  });
  const [page, setPage] = useState<SitePage | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setPage(data);
  }, [data]);

  if (isLoading || !page) return <div className="p-6 text-muted-foreground">Loading…</div>;

  const set = <K extends keyof SitePage>(k: K, v: SitePage[K]) => setPage((p) => p ? { ...p, [k]: v } : p);
  const setContent = <K extends keyof SitePage["content"]>(k: K, v: SitePage["content"][K]) =>
    setPage((p) => p ? { ...p, content: { ...p.content, [k]: v } } : p);
  const setBlocks = (blocks: Block[]) => setPage((p) => p ? { ...p, content: { ...p.content, blocks } } : p);

  const updateBlock = (i: number, patch: Partial<Block>) => {
    const next = [...page.content.blocks];
    next[i] = { ...next[i], ...patch };
    setBlocks(next);
  };
  const moveBlock = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= page.content.blocks.length) return;
    const next = [...page.content.blocks];
    [next[i], next[j]] = [next[j], next[i]];
    setBlocks(next);
  };
  const removeBlock = (i: number) => setBlocks(page.content.blocks.filter((_, idx) => idx !== i));
  const addBlock = (type: string) => setBlocks([...page.content.blocks, newBlock(type)]);

  const onSave = async () => {
    setSaving(true);
    const renamed = page.slug !== slug;
    try {
      await api(`/admin/site/pages/${slug}/${lang}`, {
        method: "PUT",
        json: {
          slug: page.slug,
          status: page.status,
          title: page.title,
          content: page.content,
          metaTitle: page.metaTitle || null,
          metaDescription: page.metaDescription || null,
          metaKeywords: page.metaKeywords || null,
          ogTitle: page.ogTitle || null,
          ogDescription: page.ogDescription || null,
          ogImage: page.ogImage || null,
          twitterCard: page.twitterCard,
          canonicalUrl: page.canonicalUrl || null,
          robotsIndex: page.robotsIndex,
        },
      });
      toast.success("Page saved");
      if (renamed) setLocation(`/website/pages/${page.slug}/${lang}`, { replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const slugInvalid = !/^[a-z0-9-]+$/.test(page.slug);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button onClick={() => setLocation("/website/pages")} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-3">
        <ChevronLeft className="w-4 h-4" /> Back to pages
      </button>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{slug} <span className="text-muted-foreground text-base">({lang.toUpperCase()})</span></h1>
          <p className="text-sm text-muted-foreground">Edit page content, SEO and visibility.</p>
        </div>
        <div className="flex items-center gap-2">
          <a href={`/${lang}/${slug === "home" ? "" : slug}`} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">View live →</a>
          <Button onClick={onSave} disabled={saving || slugInvalid}>{saving ? "Saving…" : "Save changes"}</Button>
        </div>
      </div>

      <div className="space-y-6">
        <section className="bg-card border border-border rounded-lg p-5 space-y-4">
          <h2 className="font-semibold">Page</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Title</Label>
              <Input value={page.title} onChange={(e) => set("title", e.target.value)} />
            </div>
            <div>
              <Label>Status</Label>
              <select value={page.status} onChange={(e) => set("status", e.target.value as PageStatus)} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="published">Published</option>
                <option value="draft">Draft</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <Label>Slug</Label>
              <Input
                value={page.slug}
                onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                placeholder="lowercase-with-dashes"
              />
              <p className={`text-xs mt-1 ${slugInvalid ? "text-destructive" : "text-muted-foreground"}`}>
                {slugInvalid
                  ? "Slug must contain only lowercase letters, digits and dashes."
                  : `Public URL: /${lang}/${page.slug === "home" ? "" : page.slug}`}
              </p>
            </div>
          </div>
          <div>
            <Label>Heading (hero)</Label>
            <Input value={page.content.heading || ""} onChange={(e) => setContent("heading", e.target.value)} />
          </div>
          <div>
            <Label>Subheading</Label>
            <Textarea rows={2} value={page.content.subheading || ""} onChange={(e) => setContent("subheading", e.target.value)} />
          </div>
        </section>

        <section className="bg-card border border-border rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Content blocks</h2>
            <div className="flex items-center gap-2">
              <select id="add-block" className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                {BLOCK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <Button size="sm" variant="outline" onClick={() => {
                const sel = document.getElementById("add-block") as HTMLSelectElement | null;
                addBlock(sel?.value || "richtext");
              }}><Plus className="w-4 h-4 mr-1" /> Add</Button>
            </div>
          </div>
          {page.content.blocks.length === 0 && (
            <div className="text-sm text-muted-foreground italic">No blocks yet. Add one above.</div>
          )}
          <div className="space-y-4">
            {page.content.blocks.map((b, i) => (
              <BlockCard key={i} block={b} index={i} total={page.content.blocks.length}
                onChange={(patch) => updateBlock(i, patch)}
                onMove={(d) => moveBlock(i, d)}
                onRemove={() => removeBlock(i)} />
            ))}
          </div>
        </section>

        <section className="bg-card border border-border rounded-lg p-5 space-y-4">
          <h2 className="font-semibold">SEO</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Meta title</Label>
              <Input value={page.metaTitle ?? ""} onChange={(e) => set("metaTitle", e.target.value)} />
            </div>
            <div>
              <Label>Canonical URL</Label>
              <Input value={page.canonicalUrl ?? ""} onChange={(e) => set("canonicalUrl", e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Label>Meta description</Label>
              <Textarea rows={2} value={page.metaDescription ?? ""} onChange={(e) => set("metaDescription", e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Label>Keywords (comma separated)</Label>
              <Input value={page.metaKeywords ?? ""} onChange={(e) => set("metaKeywords", e.target.value)} />
            </div>
            <div>
              <Label>OG title</Label>
              <Input value={page.ogTitle ?? ""} onChange={(e) => set("ogTitle", e.target.value)} />
            </div>
            <div>
              <Label>Twitter card</Label>
              <select value={page.twitterCard} onChange={(e) => set("twitterCard", e.target.value as TwitterCard)} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="summary_large_image">Large image</option>
                <option value="summary">Summary</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <Label>OG description</Label>
              <Textarea rows={2} value={page.ogDescription ?? ""} onChange={(e) => set("ogDescription", e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <ImagePicker label="OG image" value={page.ogImage ?? ""} onChange={(v) => set("ogImage", v)} />
              <p className="text-xs text-muted-foreground mt-1">Used for og:image and twitter:image. Recommended 1200×630.</p>
            </div>
            <div className="md:col-span-2 flex items-center gap-3">
              <Switch checked={page.robotsIndex} onCheckedChange={(v) => set("robotsIndex", v)} />
              <Label className="!mb-0">Allow search engines to index</Label>
            </div>
          </div>
        </section>

        <SeoPreviews page={page} />
      </div>
    </div>
  );
}

interface BlockCardProps {
  block: Block; index: number; total: number;
  onChange: (patch: Partial<Block>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}

function BlockCard({ block, index, total, onChange, onMove, onRemove }: BlockCardProps) {
  return (
    <div className="border border-border rounded-md p-4 bg-background">
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-xs px-2 py-0.5 rounded bg-muted">{block.type}</div>
        <div className="flex items-center gap-1">
          <button disabled={index === 0} onClick={() => onMove(-1)} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
          <button disabled={index === total - 1} onClick={() => onMove(1)} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
          <button onClick={onRemove} className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>
      <BlockFields block={block} onChange={onChange} />
    </div>
  );
}

function BlockFields({ block, onChange }: { block: Block; onChange: (patch: Partial<Block>) => void }) {
  const items: BlockItem[] = block.items ?? [];
  const setItems = (next: BlockItem[]) => onChange({ items: next });
  const updateItem = (i: number, patch: BlockItem) => {
    const next = [...items]; next[i] = { ...next[i], ...patch }; setItems(next);
  };
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));

  switch (block.type) {
    case "hero":
      return (
        <div className="space-y-2">
          <Field label="Title" value={String(block.title ?? "")} onChange={(v) => onChange({ title: v })} />
          <Field label="Subtitle" value={String(block.subtitle ?? "")} onChange={(v) => onChange({ subtitle: v })} multiline />
          <ImagePicker label="Image" value={String(block.image ?? "")} onChange={(v) => onChange({ image: v })} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="CTA label" value={String(block.ctaLabel ?? "")} onChange={(v) => onChange({ ctaLabel: v })} />
            <Field label="CTA href" value={String(block.ctaHref ?? "")} onChange={(v) => onChange({ ctaHref: v })} />
          </div>
        </div>
      );
    case "richtext":
      return (
        <div className="space-y-2">
          <Field label="Title (optional)" value={String(block.title ?? "")} onChange={(v) => onChange({ title: v })} />
          <div>
            <Label className="text-xs">Body</Label>
            <RichTextEditor value={String(block.html ?? "")} onChange={(html) => onChange({ html })} />
            <p className="text-xs text-muted-foreground mt-1">HTML is sanitized when rendered on the marketing site.</p>
          </div>
        </div>
      );
    case "cta":
      return (
        <div className="space-y-2">
          <Field label="Title" value={String(block.title ?? "")} onChange={(v) => onChange({ title: v })} />
          <Field label="Subtitle" value={String(block.subtitle ?? "")} onChange={(v) => onChange({ subtitle: v })} multiline />
          <div className="grid grid-cols-2 gap-2">
            <Field label="CTA label" value={String(block.ctaLabel ?? "")} onChange={(v) => onChange({ ctaLabel: v })} />
            <Field label="CTA href" value={String(block.ctaHref ?? "")} onChange={(v) => onChange({ ctaHref: v })} />
          </div>
        </div>
      );
    case "image":
      return (
        <div className="space-y-2">
          <ImagePicker label="Image" value={String(block.src ?? "")} onChange={(v) => onChange({ src: v })} />
          <Field label="Alt text" value={String(block.alt ?? "")} onChange={(v) => onChange({ alt: v })} />
          <Field label="Caption" value={String(block.caption ?? "")} onChange={(v) => onChange({ caption: v })} />
        </div>
      );
    case "features":
    case "steps":
    case "testimonials":
    case "faq":
      return (
        <div className="space-y-3">
          <Field label="Section title" value={String(block.title ?? "")} onChange={(v) => onChange({ title: v })} />
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="border border-border/60 rounded p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">Item {i + 1}</div>
                  <button onClick={() => removeItem(i)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></button>
                </div>
                {block.type === "features" && (
                  <>
                    <Field label="Icon (lucide name)" value={String(it.icon ?? "")} onChange={(v) => updateItem(i, { icon: v })} />
                    <Field label="Title" value={String(it.title ?? "")} onChange={(v) => updateItem(i, { title: v })} />
                    <Field label="Description" value={String(it.description ?? "")} onChange={(v) => updateItem(i, { description: v })} multiline />
                  </>
                )}
                {block.type === "steps" && (
                  <>
                    <Field label="Title" value={String(it.title ?? "")} onChange={(v) => updateItem(i, { title: v })} />
                    <Field label="Description" value={String(it.description ?? "")} onChange={(v) => updateItem(i, { description: v })} multiline />
                  </>
                )}
                {block.type === "testimonials" && (
                  <>
                    <Field label="Name" value={String(it.name ?? "")} onChange={(v) => updateItem(i, { name: v })} />
                    <Field label="Role" value={String(it.role ?? "")} onChange={(v) => updateItem(i, { role: v })} />
                    <Field label="Quote" value={String(it.quote ?? "")} onChange={(v) => updateItem(i, { quote: v })} multiline />
                    <Field label="Rating (1-5)" value={String(it.rating ?? 5)} onChange={(v) => updateItem(i, { rating: Number(v) || 5 })} />
                  </>
                )}
                {block.type === "faq" && (
                  <>
                    <Field label="Question" value={String(it.question ?? "")} onChange={(v) => updateItem(i, { question: v })} />
                    <Field label="Answer" value={String(it.answer ?? "")} onChange={(v) => updateItem(i, { answer: v })} multiline />
                  </>
                )}
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setItems([...items, {}])}>
              <Plus className="w-4 h-4 mr-1" /> Add item
            </Button>
          </div>
        </div>
      );
    default:
      return <div className="text-xs text-muted-foreground">Unknown block type.</div>;
  }
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

function SeoPreviews({ page }: { page: SitePage }) {
  const title = page.metaTitle || page.title || "Page title";
  const desc = page.metaDescription || "Page description shown in search results.";
  const ogTitle = page.ogTitle || title;
  const ogDesc = page.ogDescription || desc;
  const ogImage = page.ogImage || "";
  const slug = page.slug === "home" ? "" : page.slug;
  const path = `/${page.lang}${slug ? `/${slug}` : "/"}`;
  const host = (typeof window !== "undefined" && window.location.host) || "biddirides.com";
  const displayUrl = `https://${host.replace(/^admin\./, "")}${path}`.replace(/\/$/, "") || `https://${host}`;
  const isLarge = page.twitterCard === "summary_large_image";

  return (
    <section className="bg-card border border-border rounded-lg p-5 space-y-5">
      <div>
        <h2 className="font-semibold">Search & social previews</h2>
        <p className="text-xs text-muted-foreground">Live previews update as you edit. Actual rendering may vary.</p>
      </div>

      <div>
        <div className="text-xs font-medium text-muted-foreground mb-2">Google search result</div>
        <div className="rounded-md border border-border bg-background p-4 max-w-2xl font-sans">
          <div className="flex items-center gap-2 text-xs text-[#5f6368]">
            <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px]">B</div>
            <div>
              <div className="text-[#202124] text-xs leading-tight">BiddiRides</div>
              <div className="text-[#5f6368] text-[11px] leading-tight">{displayUrl}</div>
            </div>
          </div>
          <div className="mt-1 text-[#1a0dab] text-lg leading-snug hover:underline cursor-pointer">
            {truncate(title, 60)}
          </div>
          <div className="text-[#4d5156] text-sm leading-snug mt-0.5">
            {truncate(desc, 160)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Facebook / LinkedIn</div>
          <div className="rounded-md border border-border bg-background overflow-hidden max-w-md">
            {ogImage ? (
              <img src={ogImage} alt="" className="w-full aspect-[1.91/1] object-cover bg-muted" />
            ) : (
              <div className="w-full aspect-[1.91/1] bg-muted flex items-center justify-center text-xs text-muted-foreground">No image</div>
            )}
            <div className="p-3 border-t border-border bg-[#f2f3f5]">
              <div className="text-[11px] uppercase text-[#606770] truncate">{host.replace(/^admin\./, "")}</div>
              <div className="text-[#1d2129] text-sm font-semibold leading-tight mt-0.5">{truncate(ogTitle, 88)}</div>
              <div className="text-[#606770] text-xs leading-snug mt-1">{truncate(ogDesc, 200)}</div>
            </div>
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Twitter / X ({isLarge ? "summary_large_image" : "summary"})</div>
          <div className="rounded-2xl border border-border bg-background overflow-hidden max-w-md">
            {isLarge ? (
              ogImage ? (
                <img src={ogImage} alt="" className="w-full aspect-[1.91/1] object-cover bg-muted" />
              ) : (
                <div className="w-full aspect-[1.91/1] bg-muted flex items-center justify-center text-xs text-muted-foreground">No image</div>
              )
            ) : null}
            <div className="flex">
              {!isLarge && (
                ogImage ? (
                  <img src={ogImage} alt="" className="w-32 h-32 object-cover bg-muted shrink-0" />
                ) : (
                  <div className="w-32 h-32 bg-muted shrink-0" />
                )
              )}
              <div className="p-3 flex-1 min-w-0">
                <div className="text-[11px] text-[#536471] truncate">{host.replace(/^admin\./, "")}</div>
                <div className="text-[#0f1419] text-sm font-semibold leading-tight mt-0.5">{truncate(ogTitle, 70)}</div>
                <div className="text-[#536471] text-xs leading-snug mt-1">{truncate(ogDesc, 200)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Field({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      {multiline
        ? <Textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
        : <Input value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}
