import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/Button";
import { useAuth } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { ApiError } from "@/lib/api";
import { routeAfterAuth } from "@/lib/postAuthRedirect";

interface PwValidation {
  ok: boolean;
  reason?: "too_short" | "missing_letter" | "missing_number";
}
function validatePassword(pw: string): PwValidation {
  if (pw.length < 8) return { ok: false, reason: "too_short" };
  if (!/[A-Za-z]/.test(pw)) return { ok: false, reason: "missing_letter" };
  if (!/\d/.test(pw)) return { ok: false, reason: "missing_number" };
  return { ok: true };
}

/** Shown to legacy phone-only users right after they sign in via OTP, so
 * they can finish setting their email + password before using the app. The
 * screen blocks navigation backwards by design — the user must complete or
 * sign out. */
export default function CompleteProfileScreen() {
  const c = useColors();
  const fonts = useFontFamily();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, completeProfile, logout, refreshUser } = useAuth();
  const { t } = useTranslation();

  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!firstName.trim()) {
      setError(t("login.firstNameRequired"));
      return;
    }
    const trimmedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      setError(t("login.invalidEmail"));
      return;
    }
    const v = validatePassword(password);
    if (!v.ok) {
      setError(
        v.reason === "missing_letter"
          ? t("login.passwordNeedsLetter")
          : v.reason === "missing_number"
            ? t("login.passwordNeedsNumber")
            : t("login.passwordTooShort"),
      );
      return;
    }
    if (password !== confirmPassword) {
      setError(t("login.passwordMismatch"));
      return;
    }
    setSubmitting(true);
    try {
      await completeProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: trimmedEmail,
        password,
        referredByCode: referralCode.trim() || undefined,
      });
      const me = await refreshUser();
      if (me) routeAfterAuth(router, me);
      else router.replace("/");
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.message === "email_taken") setError(t("login.emailTaken"));
        else if (e.message === "invalid_referral") setError(t("login.invalidReferral"));
        else if (e.message === "weak_password") setError(t("login.passwordTooShort"));
        else setError(t("login.couldNotSendCode"));
      } else {
        setError(t("login.networkError"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior="padding">
      <ScrollView
        contentContainerStyle={[styles.root, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.foreground, fontFamily: fonts.bold }]}>
            {t("login.finishSetupTitle")}
          </Text>
          <Pressable onPress={handleLogout} style={styles.iconBtn}>
            <Feather name="log-out" size={20} color={c.mutedForeground} />
          </Pressable>
        </View>
        <Text style={[styles.subtitle, { color: c.mutedForeground, fontFamily: fonts.regular, lineHeight: fonts.getBodyLineHeight(14) }]}>
          {t("login.finishSetupHint")}
        </Text>

        <TextInput
          value={firstName}
          onChangeText={setFirstName}
          placeholder={t("login.firstName")}
          placeholderTextColor={c.mutedForeground}
          autoCapitalize="words"
          style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.foreground, fontFamily: fonts.medium }]}
        />
        <TextInput
          value={lastName}
          onChangeText={setLastName}
          placeholder={t("login.lastName")}
          placeholderTextColor={c.mutedForeground}
          autoCapitalize="words"
          style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.foreground, fontFamily: fonts.medium }]}
        />
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder={t("login.emailPlaceholder")}
          placeholderTextColor={c.mutedForeground}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.foreground, fontFamily: fonts.medium }]}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder={t("login.passwordPlaceholder")}
          placeholderTextColor={c.mutedForeground}
          secureTextEntry
          style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.foreground, fontFamily: fonts.medium }]}
        />
        <TextInput
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder={t("login.confirmPasswordPlaceholder")}
          placeholderTextColor={c.mutedForeground}
          secureTextEntry
          style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.foreground, fontFamily: fonts.medium }]}
        />
        <TextInput
          value={referralCode}
          onChangeText={(v) => setReferralCode(v.toUpperCase())}
          placeholder={t("login.referralPlaceholder")}
          placeholderTextColor={c.mutedForeground}
          autoCapitalize="characters"
          autoCorrect={false}
          style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.foreground, fontFamily: fonts.medium }]}
        />
        <Text style={[styles.helperText, { color: c.mutedForeground, fontFamily: fonts.regular, lineHeight: fonts.getBodyLineHeight(12) }]}>
          {t("login.passwordRules")}
        </Text>

        {error && (
          <Text style={{ color: "#ef4444", fontFamily: fonts.medium, marginTop: 8 }}>{error}</Text>
        )}

        <View style={{ marginTop: 24 }}>
          <Button
            label={t("login.finishSetup")}
            onPress={submit}
            loading={submitting}
            disabled={!firstName || !email || !password || !confirmPassword}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, paddingHorizontal: 24 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 26, flex: 1 },
  subtitle: { fontSize: 14, marginBottom: 20, lineHeight: 20 },
  input: {
    height: 56,
    borderRadius: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    fontSize: 16,
    marginBottom: 12,
  },
  helperText: { marginTop: 4, fontSize: 12, lineHeight: 18 },
});
