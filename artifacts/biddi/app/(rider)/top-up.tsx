/**
 * Wallet top-up screen — Stripe PaymentSheet flow.
 *
 * Status: STUB. The integration point is wired (StripeProvider in app root,
 * @stripe/stripe-react-native installed, /payments/setup-intent + /payments/
 * top-up endpoints live on api-server). This screen demonstrates the happy
 * path and is intentionally minimal — copy, layout, and saved-card management
 * UI are placeholders pending a UX pass.
 *
 * Hooks up:
 *  - PaymentSheet with SetupIntent (saves a card for off-session reuse)
 *  - POST /payments/top-up to charge the saved card
 *  - Wallet credit happens server-side via the webhook
 */

import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { useStripe } from "@stripe/stripe-react-native";
import { api } from "@/lib/api";

interface SetupIntentResponse {
  clientSecret: string;
  customerId: string;
  publishableKey: string;
}

interface TopUpResponse {
  paymentIntentId: string;
  status: string;
  clientSecret: string | null;
  nextAction: unknown;
}

export default function TopUpScreen() {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [amount, setAmount] = useState("20");
  const [loading, setLoading] = useState(false);
  const [lastStatus, setLastStatus] = useState<string | null>(null);

  async function handleAddCardAndTopUp() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      Alert.alert("Invalid amount", "Enter an amount greater than zero.");
      return;
    }

    setLoading(true);
    try {
      // 1. Get a SetupIntent + customer from the server.
      const setup = await api<SetupIntentResponse>("/payments/setup-intent", {
        method: "POST",
      });

      // 2. Open Stripe's PaymentSheet so the rider can enter card details.
      const init = await initPaymentSheet({
        merchantDisplayName: "Biddi",
        customerId: setup.customerId,
        setupIntentClientSecret: setup.clientSecret,
        allowsDelayedPaymentMethods: false,
      });
      if (init.error) throw new Error(init.error.message);

      const sheet = await presentPaymentSheet();
      if (sheet.error) {
        if (sheet.error.code === "Canceled") {
          setLastStatus("Canceled");
          return;
        }
        throw new Error(sheet.error.message);
      }

      // 3. Resolve the saved payment method and charge it for the top-up.
      // Note: for a fully smooth UX, list saved cards first and let the rider
      // pick. This stub just lists, takes the first card, and charges it.
      const cards = await api<{
        cards: Array<{ id: string; brand?: string; last4?: string }>;
      }>("/payments/payment-methods", { method: "GET" });
      const card = cards.cards[0];
      if (!card) {
        throw new Error("No saved card found after setup. Try again.");
      }

      const charge = await api<TopUpResponse>("/payments/top-up", {
        method: "POST",
        json: { amount: amt, paymentMethodId: card.id },
      });
      setLastStatus(charge.status);
      Alert.alert(
        "Top-up requested",
        `Status: ${charge.status}. Your wallet will reflect the credit once Stripe confirms the payment.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastStatus(`error: ${msg}`);
      Alert.alert("Top-up failed", msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 16 }}>
      <Text style={{ fontSize: 24, fontWeight: "600" }}>Top up wallet</Text>
      <Text style={{ color: "#666" }}>
        Add funds to your Biddi wallet using a card. Cards are stored securely
        with Stripe.
      </Text>

      <View>
        <Text style={{ fontSize: 14, marginBottom: 4 }}>Amount (USD)</Text>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          style={{
            borderWidth: 1,
            borderColor: "#ccc",
            borderRadius: 8,
            padding: 12,
            fontSize: 18,
          }}
        />
      </View>

      <Pressable
        onPress={handleAddCardAndTopUp}
        disabled={loading}
        style={{
          backgroundColor: loading ? "#999" : "#111",
          padding: 16,
          borderRadius: 8,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "white", fontWeight: "600" }}>
          {loading ? "Processing…" : "Add card & top up"}
        </Text>
      </Pressable>

      {lastStatus ? (
        <Text style={{ color: "#444" }}>Last status: {lastStatus}</Text>
      ) : null}
    </View>
  );
}
