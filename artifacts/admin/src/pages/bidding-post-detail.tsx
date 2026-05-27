import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowLeft, CheckCircle2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { TableHead, TableRow, TableCell } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DataTable,
  EmptyState,
  StatusBadge,
  statusToVariant,
} from "@/components/admin";
import { Gavel } from "lucide-react";

interface BiddingPostDetail {
  id: string;
  rideStatus: string;
  riderName: string;
  riderPhone: string;
  pickupLabel: string;
  pickupAddress: string;
  dropoffLabel: string;
  dropoffAddress: string;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  initialFare: number | null;
  biddingExpiresAt: string | null;
  acceptedBidId: string | null;
  acceptedDriverId: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BiddingOffer {
  id: string;
  driverId: string;
  driverName: string;
  driverPhone: string;
  driverRating: string | null;
  amount: number;
  etaMin: number;
  note: string | null;
  status: "active" | "accepted" | "rejected" | "cancelled" | "expired";
  expiresAt: string | null;
  createdAt: string;
}

interface DetailResponse {
  post: BiddingPostDetail;
  offers: BiddingOffer[];
}

export default function BiddingPostDetailPage() {
  const [, params] = useRoute<{ rideId: string }>("/bidding/posts/:rideId");
  const rideId = params?.rideId;
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [cancelReason, setCancelReason] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "bidding-post", rideId],
    queryFn: () => api<DetailResponse>(`/admin/bidding/posts/${rideId}`),
    enabled: !!rideId,
    refetchInterval: 10000,
  });

  const cancelPostMutation = useMutation({
    mutationFn: (reason: string) =>
      api(`/admin/bidding/posts/${rideId}/cancel`, {
        method: "POST",
        json: { reason },
      }),
    onSuccess: () => {
      toast.success("Bidding post cancelled");
      queryClient.invalidateQueries({ queryKey: ["admin", "bidding-posts"] });
      setLocation("/bidding/posts");
    },
    onError: (err: Error) => toast.error(err.message ?? "Could not cancel"),
  });

  const cancelOfferMutation = useMutation({
    mutationFn: (bidId: string) =>
      api(`/admin/bidding/offers/${bidId}/cancel`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Offer cancelled");
      refetch();
    },
    onError: (err: Error) => toast.error(err.message ?? "Could not cancel offer"),
  });

  if (!rideId) return null;

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/bidding/posts"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-2"
        >
          <ArrowLeft className="h-4 w-4" /> Back to bidding posts
        </Link>
        <h1 className="text-xl font-bold">Bidding post detail</h1>
        {data && (
          <p className="text-muted-foreground text-sm mt-0.5">
            Post {data.post.id}
          </p>
        )}
      </div>

      {isLoading && (
        <div className="text-sm text-muted-foreground">Loading…</div>
      )}
      {isError && (
        <div className="text-sm text-destructive">
          Could not load this post.{" "}
          <button onClick={() => refetch()} className="underline">
            Retry
          </button>
        </div>
      )}

      {data && (
        <>
          <PostSummary post={data.post} />

          {data.post.rideStatus === "bidding" && (
            <div className="mt-4">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    Force-cancel post
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel this bidding post?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The ride will be marked <code>cancelled</code> with
                      reason "admin_cancelled". All active offers on this
                      post are cancelled too. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="my-2">
                    <input
                      type="text"
                      placeholder="Reason (optional)"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      maxLength={200}
                      className="w-full px-3 py-2 text-sm rounded-md border bg-background"
                    />
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep post</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => cancelPostMutation.mutate(cancelReason)}
                      disabled={cancelPostMutation.isPending}
                    >
                      {cancelPostMutation.isPending ? "Cancelling…" : "Cancel post"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          <div className="flex items-center justify-between mt-8 mb-3">
            <h2 className="text-lg font-semibold">Offers ({data.offers.length})</h2>
          </div>

          <DataTable
            columnCount={7}
            isLoading={false}
            isError={false}
            onRetry={refetch}
            empty={
              <EmptyState
                icon={Gavel}
                title="No offers"
                description="No driver has bid on this post yet."
              />
            }
            header={
              <TableRow>
                <TableHead>Driver</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">ETA</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Placed</TableHead>
                <TableHead></TableHead>
              </TableRow>
            }
          >
            {data.offers.map((o) => {
              const isWinner =
                data.post.acceptedBidId === o.id || o.status === "accepted";
              return (
                <TableRow key={o.id} className={isWinner ? "bg-primary/5" : ""}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {isWinner && (
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                      )}
                      <div>
                        <div className="font-medium">{o.driverName}</div>
                        <div className="text-xs text-muted-foreground">
                          {o.driverPhone}
                          {o.driverRating ? ` · ★ ${o.driverRating}` : ""}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {o.amount.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">{o.etaMin} min</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                    {o.note ?? ""}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      variant={statusToVariant(o.status)}
                      className="capitalize"
                    >
                      {o.status}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {o.expiresAt ? new Date(o.expiresAt).toLocaleTimeString() : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(o.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {o.status === "active" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={cancelOfferMutation.isPending}
                        onClick={() => cancelOfferMutation.mutate(o.id)}
                        title="Force-cancel this offer"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </DataTable>
        </>
      )}
    </div>
  );
}

function PostSummary({ post }: { post: BiddingPostDetail }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <SummaryCard label="Rider">
        <div className="font-medium">{post.riderName}</div>
        <div className="text-xs text-muted-foreground">{post.riderPhone}</div>
      </SummaryCard>
      <SummaryCard label="Asking price">
        <div className="text-2xl font-bold">
          {post.initialFare != null ? post.initialFare.toFixed(2) : "—"}
        </div>
        <div className="text-xs text-muted-foreground">
          {post.estimatedDistanceKm.toFixed(1)} km · {post.estimatedDurationMin} min
        </div>
      </SummaryCard>
      <SummaryCard label="Status">
        <StatusBadge variant={statusToVariant(post.rideStatus)} className="capitalize">
          {post.rideStatus.replace("_", " ")}
        </StatusBadge>
        {post.cancelledBy && (
          <div className="text-xs text-muted-foreground mt-1">
            cancelled by {post.cancelledBy}
            {post.cancellationReason ? ` · ${post.cancellationReason}` : ""}
          </div>
        )}
      </SummaryCard>
      <SummaryCard label="Pickup" className="md:col-span-3 md:row-start-2">
        <div className="font-medium">{post.pickupLabel}</div>
        <div className="text-xs text-muted-foreground">{post.pickupAddress}</div>
      </SummaryCard>
      <SummaryCard label="Drop-off" className="md:col-span-3">
        <div className="font-medium">{post.dropoffLabel}</div>
        <div className="text-xs text-muted-foreground">{post.dropoffAddress}</div>
      </SummaryCard>
      <SummaryCard label="Created">
        <div className="text-sm">{new Date(post.createdAt).toLocaleString()}</div>
      </SummaryCard>
      <SummaryCard label="Bidding deadline">
        <div className="text-sm">
          {post.biddingExpiresAt
            ? new Date(post.biddingExpiresAt).toLocaleString()
            : "—"}
        </div>
      </SummaryCard>
      <SummaryCard label="Last updated">
        <div className="text-sm">{new Date(post.updatedAt).toLocaleString()}</div>
      </SummaryCard>
    </div>
  );
}

function SummaryCard({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border bg-card p-4 ${className}`}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}
