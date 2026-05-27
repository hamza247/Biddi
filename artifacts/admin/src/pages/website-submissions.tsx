import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Submission {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string | null;
  message: string;
  status: "new" | "read" | "archived";
  createdAt: string;
}

export default function WebsiteSubmissionsPage() {
  const qc = useQueryClient();
  type StatusFilter = "all" | "new" | "read" | "archived";
  const [status, setStatus] = useState<StatusFilter>("all");
  const { data, isLoading } = useQuery({
    queryKey: ["admin-site-submissions", status],
    queryFn: () => api<{ submissions: Submission[] }>(`/admin/site/contact-submissions${status === "all" ? "" : `?status=${status}`}`).then((r) => r.submissions),
  });

  const updateStatus = useMutation({
    mutationFn: (vars: { id: string; status: "new" | "read" | "archived" }) =>
      api(`/admin/site/contact-submissions/${vars.id}`, { method: "PATCH", json: { status: vars.status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-site-submissions"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/site/contact-submissions/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-site-submissions"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Contact submissions</h1>
          <p className="text-sm text-muted-foreground">Messages sent through the public Contact form.</p>
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">All</option>
          <option value="new">New</option>
          <option value="read">Read</option>
          <option value="archived">Archived</option>
        </select>
      </div>
      {isLoading ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : (data?.length ?? 0) === 0 ? (
        <div className="text-muted-foreground text-sm">No submissions.</div>
      ) : (
        <div className="space-y-3">
          {data!.map((sub) => (
            <div key={sub.id} className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div className="font-medium">{sub.name} <span className="text-muted-foreground font-normal">&lt;{sub.email}&gt;</span></div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(sub.createdAt).toLocaleString()}
                    {sub.phone && <> · {sub.phone}</>}
                    {sub.subject && <> · {sub.subject}</>}
                  </div>
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${sub.status === "new" ? "bg-primary/10 text-primary" : sub.status === "read" ? "bg-muted text-muted-foreground" : "bg-muted text-muted-foreground/60"}`}>{sub.status}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap text-foreground/90">{sub.message}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                {sub.status !== "read" && (
                  <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: sub.id, status: "read" })}>Mark read</Button>
                )}
                {sub.status !== "archived" && (
                  <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: sub.id, status: "archived" })}>Archive</Button>
                )}
                <a href={`mailto:${sub.email}?subject=${encodeURIComponent("Re: " + (sub.subject || "Your message"))}`} className="inline-flex items-center px-3 h-8 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90">Reply</a>
                <Button size="sm" variant="outline" className="text-destructive" onClick={() => { if (confirm("Delete this submission?")) remove.mutate(sub.id); }}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
