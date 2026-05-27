import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { api, ApiError } from "@/lib/api";
import { useConfig, type PublicConfig as AppConfig } from "@/lib/config";
import { formatDisplayAmount } from "@/lib/formatCurrency";

type WalletTxType =
  | "top_up"
  | "commission_deduction"
  | "manual_adjustment"
  | "withdrawal_request"
  | "withdrawal_paid"
  | "withdrawal_refund";

interface DisplayAmountEnvelope {
  amountUsd: number;
  displayAmount: number;
  displayCurrency: string;
  displaySymbol: string;
}

interface WalletTransaction {
  id: string;
  type: WalletTxType;
  amount: number;
  amountDisplay?: DisplayAmountEnvelope;
  rideId: string | null;
  note: string | null;
  createdAt: string;
}

interface PayoutMethod {
  method: "bank" | "mobile_money";
  accountName: string;
  bankName?: string | null;
  accountNumber?: string | null;
  iban?: string | null;
  mobileProvider?: string | null;
  mobileNumber?: string | null;
}

type WithdrawalStatus = "pending" | "approved" | "paid" | "rejected" | "cancelled";

interface Withdrawal {
  id: string;
  amount: number;
  amountDisplay?: DisplayAmountEnvelope | null;
  status: WithdrawalStatus;
  paymentReference: string | null;
  rejectionReason: string | null;
  requestedAt: string;
  decidedAt: string | null;
  paidAt: string | null;
  payoutMethod: PayoutMethod;
}

interface PublicConfig {
  minWithdrawalAmount?: number;
  minWithdrawalAmountDisplay?: DisplayAmountEnvelope;
}

const STAGGER_MS = 40;

const TX_LABEL: Record<WalletTxType, string> = {
  top_up: "Top-up",
  commission_deduction: "Commission",
  manual_adjustment: "Adjustment",
  withdrawal_request: "Withdrawal requested",
  withdrawal_paid: "Withdrawal paid",
  withdrawal_refund: "Withdrawal refund",
};

const TX_ICON: Record<WalletTxType, React.ComponentProps<typeof Feather>["name"]> = {
  top_up: "trending-up",
  commission_deduction: "trending-down",
  manual_adjustment: "sliders",
  withdrawal_request: "arrow-up-right",
  withdrawal_paid: "check-circle",
  withdrawal_refund: "rotate-ccw",
};

function payoutSummary(pm: PayoutMethod): { title: string; subtitle: string } {
  if (pm.method === "bank") {
    return {
      title: pm.bankName ?? "Bank account",
      subtitle: pm.iban ?? pm.accountNumber ?? pm.accountName,
    };
  }
  return {
    title: pm.mobileProvider ?? "Mobile money",
    subtitle: pm.mobileNumber ?? pm.accountName,
  };
}

function AnimatedTxRow({
  item,
  index,
  c,
  fonts,
  cfg,
}: {
  item: WalletTransaction;
  index: number;
  c: ReturnType<typeof useColors>;
  fonts: ReturnType<typeof useFontFamily>;
  cfg: AppConfig;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 260,
        delay: index * STAGGER_MS,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 260,
        delay: index * STAGGER_MS,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const isDeduction = item.amount < 0;
  const isZero = item.amount === 0;
  const amountColor = isZero ? c.mutedForeground : isDeduction ? "#ef4444" : "#22c55e";
  // Prefer the server-provided display envelope (already converted to
  // the platform display currency). Fall back to the raw USD amount +
  // platform symbol so older payloads still render coherently.
  const displayValue = item.amountDisplay?.displayAmount ?? item.amount;
  const amountStr = isZero
    ? "—"
    : `${isDeduction ? "−" : "+"}${formatDisplayAmount(Math.abs(displayValue), cfg)}`;

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <View style={[styles.txRow, { backgroundColor: c.surface }]}>
        <View
          style={[
            styles.txIcon,
            { backgroundColor: isDeduction ? "#fef2f2" : isZero ? c.background : "#f0fdf4" },
          ]}
        >
          <Feather name={TX_ICON[item.type]} size={16} color={amountColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.txType, { color: c.foreground, fontFamily: fonts.semiBold }]}>
            {TX_LABEL[item.type]}
          </Text>
          {item.note ? (
            <Text
              style={[styles.txNote, { color: c.mutedForeground, fontFamily: fonts.regular }]}
              numberOfLines={1}
            >
              {item.note}
            </Text>
          ) : null}
          <Text style={[styles.txDate, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
            {new Date(item.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </Text>
        </View>
        <Text style={[styles.txAmount, { color: amountColor, fontFamily: fonts.bold }]}>
          {amountStr}
        </Text>
      </View>
    </Animated.View>
  );
}

export default function WalletScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const fonts = useFontFamily();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [walletBalance, setWalletBalance] = useState("0");
  const [walletBalanceDisplay, setWalletBalanceDisplay] = useState<DisplayAmountEnvelope | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const cfg = useConfig();
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethod | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [minWithdrawal, setMinWithdrawal] = useState(10);
  const [minWithdrawalDisplay, setMinWithdrawalDisplay] =
    useState<DisplayAmountEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [payoutModalOpen, setPayoutModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);

  const pendingWithdrawal = useMemo(
    () =>
      withdrawals.find(
        (w) => w.status === "pending" || w.status === "approved",
      ) ?? null,
    [withdrawals],
  );

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [wallet, pmRes, wRes, cfg] = await Promise.all([
        api<{
          walletBalance: string;
          walletBalanceDisplay?: DisplayAmountEnvelope;
          transactions: WalletTransaction[];
        }>("/driver/me/wallet"),
        api<{ payoutMethod: PayoutMethod | null }>("/driver/me/payout-method"),
        api<{ withdrawals: Withdrawal[] }>("/driver/me/withdrawals"),
        api<PublicConfig & { minWithdrawalAmountDisplay?: DisplayAmountEnvelope }>(
          "/config/public",
        ).catch(() => ({}) as PublicConfig & { minWithdrawalAmountDisplay?: DisplayAmountEnvelope }),
      ]);
      setWalletBalance(wallet.walletBalance ?? "0");
      setWalletBalanceDisplay(wallet.walletBalanceDisplay ?? null);
      setTransactions(wallet.transactions ?? []);
      setPayoutMethod(pmRes.payoutMethod);
      setWithdrawals(wRes.withdrawals ?? []);
      if (typeof cfg.minWithdrawalAmount === "number") {
        setMinWithdrawal(cfg.minWithdrawalAmount);
      }
      setMinWithdrawalDisplay(cfg.minWithdrawalAmountDisplay ?? null);
    } catch {
      setError("Could not load wallet. Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const balance = parseFloat(walletBalance);
  // Use the server-provided display envelope when present so the
  // balance, withdrawal copy, and pending banner all show the same
  // currency the operator configured (no client-side FX math).
  const balanceDisplayValue = walletBalanceDisplay?.displayAmount ?? balance;

  const cancelWithdrawal = useCallback(
    async (id: string) => {
      try {
        const res = await api<{ walletBalance: string }>(
          `/driver/me/withdrawals/${id}/cancel`,
          { method: "POST" },
        );
        setWalletBalance(res.walletBalance);
        await load(true);
      } catch (e) {
        const msg = e instanceof ApiError ? (e.data as any)?.message ?? e.message : "Try again.";
        Alert.alert("Could not cancel", msg);
      }
    },
    [load],
  );

  const onConfirmCancel = useCallback(
    (w: Withdrawal) => {
      Alert.alert(
        "Cancel withdrawal?",
        `This will return ${formatDisplayAmount(w.amountDisplay?.displayAmount ?? w.amount, cfg)} to your wallet.`,
        [
          { text: "Keep request", style: "cancel" },
          {
            text: "Cancel withdrawal",
            style: "destructive",
            onPress: () => cancelWithdrawal(w.id),
          },
        ],
      );
    },
    [cancelWithdrawal],
  );

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <View
        style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: c.background }]}
      >
        <Pressable
          onPress={() => router.back()}
          style={[styles.backBtn, { backgroundColor: c.surface }]}
          hitSlop={8}
        >
          <Feather name={fonts.isRTL ? "arrow-right" : "arrow-left"} size={20} color={c.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.foreground, fontFamily: fonts.bold }]}>
          My Wallet
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
            {error}
          </Text>
          <Pressable onPress={() => load()} style={{ marginTop: 12 }}>
            <Text style={{ color: c.primary, fontFamily: fonts.semiBold }}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: insets.bottom + 24,
            gap: 8,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={c.primary}
            />
          }
          ListHeaderComponent={
            <View style={{ gap: 16 }}>
              <View style={[styles.balanceCard, { backgroundColor: c.primary }]}>
                <Text
                  style={[
                    styles.balanceLabel,
                    { color: "rgba(255,255,255,0.75)", fontFamily: fonts.semiBold },
                  ]}
                >
                  Available Balance
                </Text>
                <Text
                  style={[
                    styles.balanceAmount,
                    { color: "#fff", fontFamily: fonts.bold },
                  ]}
                >
                  {formatDisplayAmount(balanceDisplayValue, cfg)}
                </Text>
                <Pressable
                  onPress={() => {
                    if (!payoutMethod) {
                      Alert.alert(
                        "Add a payout method",
                        "Save your payout details before requesting a withdrawal.",
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Add now",
                            onPress: () => setPayoutModalOpen(true),
                          },
                        ],
                      );
                      return;
                    }
                    if (pendingWithdrawal) {
                      Alert.alert(
                        "Pending withdrawal",
                        "You already have a withdrawal in progress.",
                      );
                      return;
                    }
                    setWithdrawModalOpen(true);
                  }}
                  style={({ pressed }) => [
                    styles.withdrawBtn,
                    { opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  <Feather name="arrow-up-right" size={16} color={c.primary} />
                  <Text style={[styles.withdrawBtnText, { color: c.primary, fontFamily: fonts.bold }]}>
                    Request withdrawal
                  </Text>
                </Pressable>
                <Text
                  style={[
                    styles.balanceSub,
                    { color: "rgba(255,255,255,0.65)", fontFamily: fonts.medium },
                  ]}
                >
                  Min withdrawal {formatDisplayAmount(minWithdrawalDisplay?.displayAmount ?? minWithdrawal, cfg)}. Commission is deducted automatically on cash trips.
                </Text>
              </View>

              {pendingWithdrawal ? (
                <View
                  style={[
                    styles.pendingBanner,
                    { backgroundColor: c.surface, borderColor: c.border },
                  ]}
                >
                  <View
                    style={[
                      styles.pendingIcon,
                      { backgroundColor: pendingWithdrawal.status === "approved" ? "#dcfce7" : "#fef9c3" },
                    ]}
                  >
                    <Feather
                      name={pendingWithdrawal.status === "approved" ? "check" : "clock"}
                      size={16}
                      color={pendingWithdrawal.status === "approved" ? "#16a34a" : "#ca8a04"}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.pendingTitle,
                        { color: c.foreground, fontFamily: fonts.semiBold },
                      ]}
                    >
                      {formatDisplayAmount(pendingWithdrawal.amountDisplay?.displayAmount ?? pendingWithdrawal.amount, cfg)} ·{" "}
                      {pendingWithdrawal.status === "approved" ? "Approved" : "Pending review"}
                    </Text>
                    <Text
                      style={[
                        styles.pendingSub,
                        { color: c.mutedForeground, fontFamily: fonts.regular },
                      ]}
                    >
                      {payoutSummary(pendingWithdrawal.payoutMethod).title} ·{" "}
                      {new Date(pendingWithdrawal.requestedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </Text>
                  </View>
                  {pendingWithdrawal.status === "pending" ? (
                    <Pressable
                      onPress={() => onConfirmCancel(pendingWithdrawal)}
                      style={({ pressed }) => [
                        styles.cancelLink,
                        { opacity: pressed ? 0.6 : 1 },
                      ]}
                      hitSlop={8}
                    >
                      <Text
                        style={{
                          color: "#ef4444",
                          fontFamily: fonts.semiBold,
                          fontSize: 13,
                        }}
                      >
                        Cancel
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              <Pressable
                onPress={() => setPayoutModalOpen(true)}
                style={({ pressed }) => [
                  styles.payoutCard,
                  {
                    backgroundColor: c.surface,
                    borderColor: c.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.payoutIcon,
                    { backgroundColor: payoutMethod ? "#eef2ff" : c.background },
                  ]}
                >
                  <Feather
                    name={payoutMethod?.method === "mobile_money" ? "smartphone" : "credit-card"}
                    size={18}
                    color={payoutMethod ? "#6366f1" : c.mutedForeground}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.payoutTitle,
                      { color: c.foreground, fontFamily: fonts.semiBold },
                    ]}
                  >
                    {payoutMethod ? payoutSummary(payoutMethod).title : "Add payout method"}
                  </Text>
                  <Text
                    style={[
                      styles.payoutSub,
                      { color: c.mutedForeground, fontFamily: fonts.regular },
                    ]}
                    numberOfLines={1}
                  >
                    {payoutMethod
                      ? payoutSummary(payoutMethod).subtitle
                      : "Save bank or mobile money details to receive payouts."}
                  </Text>
                </View>
                <Feather name={fonts.isRTL ? "chevron-left" : "chevron-right"} size={18} color={c.mutedForeground} />
              </Pressable>

              {transactions.length > 0 && (
                <Text
                  style={[
                    styles.sectionTitle,
                    { color: c.mutedForeground, fontFamily: fonts.semiBold },
                  ]}
                >
                  Transaction History
                </Text>
              )}
            </View>
          }
          ListHeaderComponentStyle={{ marginBottom: 8 }}
          ListEmptyComponent={
            <View style={[styles.emptyBox, { backgroundColor: c.surface }]}>
              <Feather name="credit-card" size={28} color={c.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: c.foreground, fontFamily: fonts.bold }]}>
                No transactions yet
              </Text>
              <Text style={[styles.emptySub, { color: c.mutedForeground, fontFamily: fonts.medium, lineHeight: fonts.getBodyLineHeight(13) }]}>
                Commission deductions, top-ups and withdrawals will appear here.
              </Text>
            </View>
          }
          renderItem={({ item, index }) => (
            <AnimatedTxRow item={item} index={index} c={c} fonts={fonts} cfg={cfg} />
          )}
        />
      )}

      <PayoutMethodModal
        visible={payoutModalOpen}
        onClose={() => setPayoutModalOpen(false)}
        existing={payoutMethod}
        onSaved={(pm) => {
          setPayoutMethod(pm);
          setPayoutModalOpen(false);
        }}
      />

      <WithdrawModal
        visible={withdrawModalOpen}
        onClose={() => setWithdrawModalOpen(false)}
        balanceUsd={balance}
        balanceDisplay={walletBalanceDisplay}
        minWithdrawalUsd={minWithdrawal}
        minWithdrawalDisplay={minWithdrawalDisplay}
        payoutMethod={payoutMethod}
        cfg={cfg}
        onSubmitted={(newBalance) => {
          setWalletBalance(newBalance);
          // Drop the stale display envelope so render falls back to the
          // freshly-set USD walletBalance until load(true) refreshes the
          // server-converted envelope; never show a stale converted value.
          setWalletBalanceDisplay(null);
          setWithdrawModalOpen(false);
          load(true);
        }}
      />
    </View>
  );
}

// ─── Payout method modal ────────────────────────────────────────────────────

function PayoutMethodModal({
  visible,
  onClose,
  existing,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  existing: PayoutMethod | null;
  onSaved: (pm: PayoutMethod) => void;
}) {
  const c = useColors();
  const fonts = useFontFamily();
  const insets = useSafeAreaInsets();

  const [method, setMethod] = useState<"bank" | "mobile_money">(existing?.method ?? "bank");
  const [accountName, setAccountName] = useState(existing?.accountName ?? "");
  const [bankName, setBankName] = useState(existing?.bankName ?? "");
  const [accountNumber, setAccountNumber] = useState(existing?.accountNumber ?? "");
  const [iban, setIban] = useState(existing?.iban ?? "");
  const [mobileProvider, setMobileProvider] = useState(existing?.mobileProvider ?? "");
  const [mobileNumber, setMobileNumber] = useState(existing?.mobileNumber ?? "");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setMethod(existing?.method ?? "bank");
    setAccountName(existing?.accountName ?? "");
    setBankName(existing?.bankName ?? "");
    setAccountNumber(existing?.accountNumber ?? "");
    setIban(existing?.iban ?? "");
    setMobileProvider(existing?.mobileProvider ?? "");
    setMobileNumber(existing?.mobileNumber ?? "");
  }, [visible, existing]);

  const submit = async () => {
    if (submitting) return;
    if (!accountName.trim()) {
      Alert.alert("Missing info", "Enter the account holder name.");
      return;
    }
    if (method === "bank") {
      if (!bankName.trim()) {
        Alert.alert("Missing info", "Enter the bank name.");
        return;
      }
      if (!accountNumber.trim() && !iban.trim()) {
        Alert.alert("Missing info", "Provide either an account number or an IBAN.");
        return;
      }
    } else {
      if (!mobileProvider.trim()) {
        Alert.alert("Missing info", "Enter the mobile money provider.");
        return;
      }
      if (!mobileNumber.trim()) {
        Alert.alert("Missing info", "Enter the mobile money number.");
        return;
      }
    }
    setSubmitting(true);
    try {
      const body =
        method === "bank"
          ? {
              method: "bank" as const,
              accountName: accountName.trim(),
              bankName: bankName.trim(),
              accountNumber: accountNumber.trim() || null,
              iban: iban.trim() || null,
            }
          : {
              method: "mobile_money" as const,
              accountName: accountName.trim(),
              mobileProvider: mobileProvider.trim(),
              mobileNumber: mobileNumber.trim(),
            };
      const res = await api<{ payoutMethod: PayoutMethod }>(
        "/driver/me/payout-method",
        { method: "PUT", json: body },
      );
      onSaved(res.payoutMethod);
    } catch (e) {
      const msg = e instanceof ApiError ? (e.data as any)?.message ?? "Could not save." : "Try again.";
      Alert.alert("Save failed", msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ width: "100%" }}
        >
          <View
            style={[
              styles.modalSheet,
              { backgroundColor: c.background, paddingBottom: insets.bottom + 16 },
            ]}
          >
            <View style={[styles.modalHandle, { backgroundColor: c.border }]} />
            <Text style={[styles.modalTitle, { color: c.foreground, fontFamily: fonts.bold }]}>
              Payout method
            </Text>
            <Text
              style={[styles.modalSub, { color: c.mutedForeground, fontFamily: fonts.regular }]}
            >
              We'll use these details to send your withdrawals.
            </Text>

            <View style={styles.tabRow}>
              {(["bank", "mobile_money"] as const).map((m) => {
                const active = method === m;
                return (
                  <Pressable
                    key={m}
                    onPress={() => setMethod(m)}
                    style={[
                      styles.tab,
                      {
                        backgroundColor: active ? c.primary : c.surface,
                        borderColor: active ? c.primary : c.border,
                      },
                    ]}
                  >
                    <Feather
                      name={m === "bank" ? "credit-card" : "smartphone"}
                      size={14}
                      color={active ? "#fff" : c.foreground}
                    />
                    <Text
                      style={[
                        styles.tabText,
                        {
                          color: active ? "#fff" : c.foreground,
                          fontFamily: fonts.semiBold,
                        },
                      ]}
                    >
                      {m === "bank" ? "Bank" : "Mobile money"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 360 }}>
              <Field
                label="Account holder name"
                value={accountName}
                onChangeText={setAccountName}
                placeholder="Full name on the account"
                c={c}
                fonts={fonts}
              />
              {method === "bank" ? (
                <>
                  <Field
                    label="Bank name"
                    value={bankName}
                    onChangeText={setBankName}
                    placeholder="e.g. Attijariwafa Bank"
                    c={c}
                    fonts={fonts}
                  />
                  <Field
                    label="Account number"
                    value={accountNumber}
                    onChangeText={setAccountNumber}
                    placeholder="Optional if IBAN is provided"
                    c={c}
                    fonts={fonts}
                  />
                  <Field
                    label="IBAN"
                    value={iban}
                    onChangeText={(v) => setIban(v.toUpperCase())}
                    placeholder="Optional if account number is provided"
                    c={c}
                    fonts={fonts}
                    autoCapitalize="characters"
                  />
                </>
              ) : (
                <>
                  <Field
                    label="Provider"
                    value={mobileProvider}
                    onChangeText={setMobileProvider}
                    placeholder="e.g. Orange Money, M-Pesa"
                    c={c}
                    fonts={fonts}
                  />
                  <Field
                    label="Mobile number"
                    value={mobileNumber}
                    onChangeText={setMobileNumber}
                    placeholder="+212 6XX XXX XXX"
                    c={c}
                    fonts={fonts}
                    keyboardType="phone-pad"
                  />
                </>
              )}
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [
                  styles.btnGhost,
                  { borderColor: c.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={{ color: c.foreground, fontFamily: fonts.semiBold }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submit}
                disabled={submitting}
                style={({ pressed }) => [
                  styles.btnPrimary,
                  { backgroundColor: c.primary, opacity: pressed || submitting ? 0.8 : 1 },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ color: "#fff", fontFamily: fonts.bold }}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Withdraw modal ─────────────────────────────────────────────────────────

function WithdrawModal({
  visible,
  onClose,
  balanceUsd,
  balanceDisplay,
  minWithdrawalUsd,
  minWithdrawalDisplay,
  payoutMethod,
  cfg,
  onSubmitted,
}: {
  visible: boolean;
  onClose: () => void;
  balanceUsd: number;
  balanceDisplay: DisplayAmountEnvelope | null;
  minWithdrawalUsd: number;
  minWithdrawalDisplay: DisplayAmountEnvelope | null;
  payoutMethod: PayoutMethod | null;
  cfg: AppConfig;
  onSubmitted: (newBalance: string) => void;
}) {
  const c = useColors();
  const fonts = useFontFamily();
  const insets = useSafeAreaInsets();
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) setAmount("");
  }, [visible]);

  const summary = payoutMethod ? payoutSummary(payoutMethod) : null;
  const parsed = Number(amount.replace(/,/g, "."));

  // Show + validate everything in the platform display currency. The user
  // types the amount they see; we convert it back to USD only at submit
  // time using the same rate the server used to enrich the envelopes —
  // never pair display symbols with raw USD numbers.
  const balanceShown = balanceDisplay?.displayAmount ?? balanceUsd;
  const minShown = minWithdrawalDisplay?.displayAmount ?? minWithdrawalUsd;
  // Derive USD-per-display from the envelope (displayAmount/amountUsd) so
  // we don't depend on a separate /config/public field.
  const usdPerDisplay = (() => {
    const env = balanceDisplay ?? minWithdrawalDisplay;
    if (env && env.displayAmount > 0 && env.amountUsd > 0) {
      return env.amountUsd / env.displayAmount;
    }
    return 1;
  })();

  const submit = async () => {
    if (submitting) return;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      Alert.alert("Invalid amount", "Enter a positive amount.");
      return;
    }
    if (parsed < minShown) {
      Alert.alert(
        "Below minimum",
        `Minimum withdrawal is ${formatDisplayAmount(minShown, cfg)}.`,
      );
      return;
    }
    if (parsed > balanceShown) {
      Alert.alert("Insufficient balance", "You do not have enough wallet balance.");
      return;
    }
    // Convert the user-entered display-currency amount back to USD before
    // posting; the server stores withdrawals in USD.
    const amountUsd = Math.round(parsed * usdPerDisplay * 100) / 100;
    setSubmitting(true);
    try {
      const res = await api<{ walletBalance: string }>("/driver/me/withdrawals", {
        method: "POST",
        json: { amount: amountUsd },
      });
      onSubmitted(res.walletBalance);
    } catch (e) {
      const msg = e instanceof ApiError ? (e.data as any)?.message ?? "Could not request." : "Try again.";
      Alert.alert("Withdrawal failed", msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ width: "100%" }}
        >
          <View
            style={[
              styles.modalSheet,
              { backgroundColor: c.background, paddingBottom: insets.bottom + 16 },
            ]}
          >
            <View style={[styles.modalHandle, { backgroundColor: c.border }]} />
            <Text style={[styles.modalTitle, { color: c.foreground, fontFamily: fonts.bold }]}>
              Request withdrawal
            </Text>
            <Text
              style={[styles.modalSub, { color: c.mutedForeground, fontFamily: fonts.regular }]}
            >
              Available {formatDisplayAmount(balanceShown, cfg)} · Min {formatDisplayAmount(minShown, cfg)}
            </Text>

            {summary ? (
              <View
                style={[
                  styles.payoutSummary,
                  { backgroundColor: c.surface, borderColor: c.border },
                ]}
              >
                <Feather
                  name={payoutMethod?.method === "mobile_money" ? "smartphone" : "credit-card"}
                  size={16}
                  color={c.mutedForeground}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ color: c.foreground, fontFamily: fonts.semiBold, fontSize: 13 }}
                  >
                    {summary.title}
                  </Text>
                  <Text
                    style={{ color: c.mutedForeground, fontFamily: fonts.regular, fontSize: 12 }}
                    numberOfLines={1}
                  >
                    {summary.subtitle}
                  </Text>
                </View>
              </View>
            ) : null}

            <View style={styles.amountRow}>
              <Text
                style={[styles.currencyMark, { color: c.mutedForeground, fontFamily: fonts.bold }]}
              >
                {cfg.displaySymbol}
              </Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={c.mutedForeground}
                style={[styles.amountInput, { color: c.foreground, fontFamily: fonts.bold }]}
              />
            </View>

            <View style={styles.modalActions}>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [
                  styles.btnGhost,
                  { borderColor: c.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={{ color: c.foreground, fontFamily: fonts.semiBold }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submit}
                disabled={submitting}
                style={({ pressed }) => [
                  styles.btnPrimary,
                  { backgroundColor: c.primary, opacity: pressed || submitting ? 0.8 : 1 },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ color: "#fff", fontFamily: fonts.bold }}>Request</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  c,
  fonts,
  autoCapitalize,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  c: ReturnType<typeof useColors>;
  fonts: ReturnType<typeof useFontFamily>;
  autoCapitalize?: "characters" | "none" | "sentences" | "words";
  keyboardType?: React.ComponentProps<typeof TextInput>["keyboardType"];
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text
        style={[
          styles.fieldLabel,
          { color: c.mutedForeground, fontFamily: fonts.semiBold },
        ]}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.mutedForeground}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        style={[
          styles.fieldInput,
          {
            color: c.foreground,
            backgroundColor: c.surface,
            borderColor: c.border,
            fontFamily: fonts.medium,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { flex: 1, fontSize: 18, textAlign: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorText: { fontSize: 14, textAlign: "center" },
  balanceCard: { borderRadius: 16, padding: 24, marginTop: 12, gap: 6 },
  balanceLabel: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.8 },
  balanceAmount: { fontSize: 40, marginTop: 2 },
  balanceSub: { fontSize: 12, marginTop: 6, lineHeight: 18 },
  withdrawBtn: {
    marginTop: 14,
    backgroundColor: "#fff",
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  withdrawBtnText: { fontSize: 13 },
  pendingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  pendingIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  pendingTitle: { fontSize: 14 },
  pendingSub: { fontSize: 12, marginTop: 1 },
  cancelLink: { paddingHorizontal: 8, paddingVertical: 4 },
  payoutCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  payoutIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  payoutTitle: { fontSize: 14 },
  payoutSub: { fontSize: 12, marginTop: 2 },
  sectionTitle: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 8,
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
  },
  txIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  txType: { fontSize: 14 },
  txNote: { fontSize: 12, marginTop: 1 },
  txDate: { fontSize: 11, marginTop: 2 },
  txAmount: { fontSize: 16 },
  emptyBox: {
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    gap: 8,
    marginTop: 16,
  },
  emptyTitle: { fontSize: 16, marginTop: 8 },
  emptySub: { fontSize: 13, textAlign: "center", lineHeight: 20 },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 12,
  },
  modalTitle: { fontSize: 18 },
  modalSub: { fontSize: 13, marginTop: 4, marginBottom: 16 },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  btnGhost: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnPrimary: {
    flex: 2,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  tabRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  tabText: { fontSize: 13 },
  fieldLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 },
  fieldInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    fontSize: 15,
  },
  payoutSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  currencyMark: { fontSize: 32 },
  amountInput: {
    flex: 1,
    fontSize: 36,
    paddingVertical: 8,
  },
});
