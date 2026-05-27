import * as Icons from "lucide-react";
import type { ComponentType } from "react";
import { Star } from "lucide-react";
import DOMPurify from "isomorphic-dompurify";

interface Block {
  type: string;
  [k: string]: any;
}

function Icon({ name, className }: { name?: string; className?: string }) {
  if (!name) return null;
  const C = (Icons as unknown as Record<string, ComponentType<{ className?: string }>>)[name];
  if (!C) return null;
  return <C className={className} />;
}

function Hero({ block }: { block: Block }) {
  return (
    <section className="container-page py-16 md:py-24 text-center">
      {block.title && <h1 className="font-display text-4xl md:text-6xl font-bold tracking-tight">{block.title}</h1>}
      {block.subtitle && <p className="mt-5 text-lg text-muted-foreground max-w-2xl mx-auto">{block.subtitle}</p>}
      {block.ctaLabel && (
        <a href={block.ctaHref || "#"} className="btn-primary mt-8">{block.ctaLabel}</a>
      )}
    </section>
  );
}

function Features({ block }: { block: Block }) {
  const items = (block.items ?? []) as { icon?: string; title: string; description: string }[];
  return (
    <section className="container-page py-16">
      {block.title && <h2 className="font-display text-3xl md:text-4xl font-bold text-center mb-12">{block.title}</h2>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {items.map((it, i) => (
          <div key={i} className="card-soft text-start">
            <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-primary/10 text-primary mb-4">
              <Icon name={it.icon} className="w-6 h-6" />
            </div>
            <h3 className="font-display font-semibold text-lg mb-2">{it.title}</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">{it.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Steps({ block }: { block: Block }) {
  const items = (block.items ?? []) as { title: string; description: string }[];
  return (
    <section className="bg-muted/40 py-16">
      <div className="container-page">
        {block.title && <h2 className="font-display text-3xl md:text-4xl font-bold text-center mb-12">{block.title}</h2>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {items.map((it, i) => (
            <div key={i} className="text-center">
              <div className="mx-auto inline-flex items-center justify-center h-14 w-14 rounded-full bg-primary text-primary-foreground font-bold text-xl mb-4">{i + 1}</div>
              <h3 className="font-display font-semibold text-lg mb-2">{it.title}</h3>
              <p className="text-muted-foreground text-sm">{it.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Testimonials({ block }: { block: Block }) {
  const items = (block.items ?? []) as { name: string; role?: string; quote: string; rating?: number }[];
  return (
    <section className="container-page py-16">
      {block.title && <h2 className="font-display text-3xl md:text-4xl font-bold text-center mb-12">{block.title}</h2>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {items.map((it, i) => (
          <div key={i} className="card-soft">
            <div className="flex items-center gap-1 text-secondary mb-3">
              {Array.from({ length: it.rating ?? 5 }).map((_, k) => <Star key={k} className="w-4 h-4 fill-current" />)}
            </div>
            <p className="text-foreground/90 italic">"{it.quote}"</p>
            <div className="mt-4 text-sm font-semibold">{it.name}{it.role && <span className="text-muted-foreground font-normal"> · {it.role}</span>}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Faq({ block }: { block: Block }) {
  const items = (block.items ?? []) as { question: string; answer: string }[];
  return (
    <section className="container-page py-16">
      {block.title && <h2 className="font-display text-3xl md:text-4xl font-bold text-center mb-12">{block.title}</h2>}
      <div className="max-w-3xl mx-auto space-y-3">
        {items.map((it, i) => (
          <details key={i} className="group card-soft cursor-pointer">
            <summary className="flex items-center justify-between font-display font-semibold text-lg list-none">
              <span>{it.question}</span>
              <span className="ms-4 text-muted-foreground group-open:rotate-45 transition-transform text-2xl leading-none">+</span>
            </summary>
            <p className="mt-4 text-muted-foreground leading-relaxed">{it.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function RichText({ block }: { block: Block }) {
  return (
    <section className="container-page py-12">
      {block.title && <h2 className="font-display text-2xl md:text-3xl font-bold mb-6">{block.title}</h2>}
      <div
        className="prose prose-slate max-w-3xl"
        dangerouslySetInnerHTML={{
          __html: DOMPurify.sanitize(String(block.html ?? ""), {
            USE_PROFILES: { html: true },
            FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
            FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "style"],
          }),
        }}
      />
    </section>
  );
}

function Cta({ block }: { block: Block }) {
  return (
    <section className="container-page py-20">
      <div className="rounded-3xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground p-10 md:p-16 text-center">
        {block.title && <h2 className="font-display text-3xl md:text-4xl font-bold">{block.title}</h2>}
        {block.subtitle && <p className="mt-3 text-primary-foreground/85 max-w-xl mx-auto">{block.subtitle}</p>}
        {block.ctaLabel && (
          <a href={block.ctaHref || "#"} className="inline-flex items-center justify-center mt-6 rounded-full bg-secondary text-secondary-foreground px-7 py-3 font-semibold hover:opacity-90 transition">{block.ctaLabel}</a>
        )}
      </div>
    </section>
  );
}

function ImageBlock({ block }: { block: Block }) {
  if (!block.src) return null;
  return (
    <figure className="container-page py-8 max-w-4xl">
      <img src={block.src} alt={block.alt || ""} loading="lazy" decoding="async" className="rounded-2xl w-full" />
      {block.caption && <figcaption className="text-center text-sm text-muted-foreground mt-3">{block.caption}</figcaption>}
    </figure>
  );
}

export function BlockRenderer({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "hero": return <Hero key={i} block={b} />;
          case "features": return <Features key={i} block={b} />;
          case "steps": return <Steps key={i} block={b} />;
          case "testimonials": return <Testimonials key={i} block={b} />;
          case "faq": return <Faq key={i} block={b} />;
          case "richtext": return <RichText key={i} block={b} />;
          case "cta": return <Cta key={i} block={b} />;
          case "image": return <ImageBlock key={i} block={b} />;
          default: return null;
        }
      })}
    </>
  );
}
