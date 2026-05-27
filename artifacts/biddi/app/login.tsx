import { Feather } from "@expo/vector-icons";
import * as Localization from "expo-localization";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/Button";
import { CountryCodePicker } from "@/components/CountryCodePicker";
import { useAuth } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { api, ApiError, getTokenSync, loadToken } from "@/lib/api";
import {
  enableBiometricLogin,
  getBiometricCapability,
  getBiometricLabel,
  isBiometricLoginEnabled,
  markBiometricPromptShown,
  promptBiometric,
  readBiometricToken,
  wasBiometricPromptShown,
} from "@/lib/biometric";
import { DEFAULT_DIAL_CODE, findDialByIso2, type DialCode } from "@/lib/dialCodes";
import { routeAfterAuth } from "@/lib/postAuthRedirect";
import { getJSON, setJSON } from "@/lib/storage";

const DIAL_CODE_STORAGE_KEY = "auth_dial_code_iso2";

type Mode = "phone" | "email";
type Step = "phone" | "otp" | "profile" | "password" | "done";

interface PasswordValidation {
  ok: boolean;
  reason?: "too_short" | "missing_letter" | "missing_number";
}
function validatePassword(pw: string): PasswordValidation {
  if (pw.length < 8) return { ok: false, reason: "too_short" };
  if (!/[A-Za-z]/.test(pw)) return { ok: false, reason: "missing_letter" };
  if (!/\d/.test(pw)) return { ok: false, reason: "missing_number" };
  return { ok: true };
}

export default function LoginScreen() {
  const c = useColors();
  const fonts = useFontFamily();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    requestOtp,
    verifyOtp,
    loginWithPassword,
    loginWithToken,
    completeProfile,
    refreshUser,
  } = useAuth();
  const { t } = useTranslation();

  const [mode, setMode] = useState<Mode>("phone");
  const [step, setStep] = useState<Step>("phone");
  const [signInTab, setSignInTab] = useState<"signin" | "register">("signin");
  const [dial, setDial] = useState<DialCode>(DEFAULT_DIAL_CODE);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", ""]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bioLabel, setBioLabel] = useState<string | null>(null);
  const otpRefs = useRef<Array<TextInput | null>>([]);

  const digits = phone.replace(/\D/g, "").slice(0, 14);
  const fullPhone = `${dial.dial}${digits}`;

  // Biometric availability check on mount.
  useEffect(() => {
    (async () => {
      const enabled = await isBiometricLoginEnabled();
      if (enabled) {
        const label = await getBiometricLabel();
        setBioLabel(label || "biometric");
      }
    })();
  }, []);

  // Auto-detect the dial code on first open: prefer the previously persisted
  // choice, otherwise fall back to the device locale's region. We never
  // overwrite the curated Morocco default if neither yields a known country.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await getJSON<string>(DIAL_CODE_STORAGE_KEY);
        if (!cancelled && saved) {
          const fromSaved = findDialByIso2(saved);
          if (fromSaved) {
            setDial(fromSaved);
            return;
          }
        }
        const locales = Localization.getLocales();
        const region = locales[0]?.regionCode ?? null;
        const fromLocale = findDialByIso2(region);
        if (!cancelled && fromLocale) {
          setDial(fromLocale);
        }
      } catch {
        /* keep DEFAULT_DIAL_CODE */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist the user's chosen dial code so subsequent launches start in the
  // right country immediately.
  const handleDialChange = useCallback((next: DialCode) => {
    setDial(next);
    setJSON(DIAL_CODE_STORAGE_KEY, next.iso2).catch(() => {});
  }, []);

  /** After every successful authentication, offer to enable biometric sign-in
   * once. The prompt is cosmetic — declining doesn't block the flow, and we
   * remember the answer so we don't ask again. */
  const maybeOfferBiometric = useCallback(async () => {
    if (await wasBiometricPromptShown()) return;
    if (await isBiometricLoginEnabled()) return;
    const cap = await getBiometricCapability();
    if (!cap.available || !cap.enrolled) return;
    await markBiometricPromptShown();
    const title =
      cap.label === "face"
        ? t("login.bioOfferTitleFace")
        : cap.label === "fingerprint"
          ? t("login.bioOfferTitleFingerprint")
          : t("login.bioOfferTitle");
    return new Promise<void>((resolve) => {
      Alert.alert(title, t("login.bioOfferBody"), [
        { text: t("login.bioOfferLater"), style: "cancel", onPress: () => resolve() },
        {
          text: t("login.bioOfferEnable"),
          onPress: async () => {
            try {
              const ok = await promptBiometric(t("login.bioPrompt"));
              if (!ok) return;
              const token = getTokenSync() ?? (await loadToken());
              if (!token) return;
              await enableBiometricLogin(token, cap.label);
            } catch {
              /* user can still enable later from Profile */
            } finally {
              resolve();
            }
          },
        },
      ]);
    });
  }, [t]);

  const finishAuth = useCallback(
    async (nextUser: { appMode: "rider" | "driver"; driverStatus: string } | null | undefined) => {
      // Best effort: kick off the biometric offer but don't block routing on it.
      maybeOfferBiometric().catch(() => {});
      const u = nextUser ?? null;
      if (u) {
        routeAfterAuth(router, u as never);
      } else {
        router.replace("/");
      }
    },
    [router, maybeOfferBiometric],
  );

  const reset = useCallback(() => {
    setStep("phone");
    setPhone("");
    setOtp(["", "", "", ""]);
    setFirstName("");
    setLastName("");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setReferralCode("");
    setError(null);
    setDevCode(null);
  }, []);

  const switchTab = (tab: "signin" | "register") => {
    setSignInTab(tab);
    reset();
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
  };

  const handleSendOtp = async () => {
    if (digits.length < 6) return;
    setSubmitting(true);
    setError(null);
    try {
      if (signInTab === "register") {
        const check = await api<{ exists: boolean }>("/auth/check-phone", {
          method: "POST",
          json: { phone: fullPhone },
        });
        if (check.exists) {
          setError(t("login.alreadyRegistered"));
          return;
        }
      }
      const r = await requestOtp(fullPhone);
      setDevCode(r.devCode);
      setStep("otp");
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setError(t("login.rateLimitedSend"));
      } else if (
        e instanceof TypeError ||
        (e instanceof Error && e.message.toLowerCase().includes("network"))
      ) {
        setError(t("login.networkError"));
      } else {
        setError(t("login.couldNotSendCode"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOtpChange = (text: string, idx: number) => {
    const d = text.replace(/\D/g, "");
    if (d.length > 1) {
      const next = [...otp];
      let lastFilled = idx;
      for (let i = 0; i < d.length && idx + i < 4; i++) {
        next[idx + i] = d[i];
        lastFilled = idx + i;
      }
      setOtp(next);
      otpRefs.current[lastFilled]?.focus();
      return;
    }
    const ch = d.slice(0, 1);
    const next = [...otp];
    next[idx] = ch;
    setOtp(next);
    if (ch && idx < 3) otpRefs.current[idx + 1]?.focus();
  };

  const handleOtpKeyPress = (key: string, idx: number) => {
    if (key !== "Backspace") return;
    if (otp[idx] === "" && idx > 0) {
      const next = [...otp];
      next[idx - 1] = "";
      setOtp(next);
      otpRefs.current[idx - 1]?.focus();
    }
  };

  const handleVerify = useCallback(async () => {
    const code = otp.join("");
    if (code.length !== 4 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { needsProfileCompletion } = await verifyOtp(
        fullPhone,
        code,
        undefined,
        dial.dial,
      );
      if (signInTab === "signin") {
        if (needsProfileCompletion) {
          router.replace("/complete-profile" as never);
        } else {
          const me = await refreshUser();
          await finishAuth(me ?? null);
        }
      } else {
        // Registration flow continues in-screen so the new user finishes
        // setting their name + password before landing on home.
        setStep("profile");
      }
    } catch {
      setError(t("login.invalidCode"));
    } finally {
      setSubmitting(false);
    }
  }, [otp, submitting, fullPhone, dial.dial, signInTab, verifyOtp, router, t]);

  useEffect(() => {
    if (step === "otp" && otp.join("").length === 4 && !submitting) {
      handleVerify();
    }
  }, [otp, step, submitting, handleVerify]);

  const handleProfileNext = () => {
    setError(null);
    if (!firstName.trim()) {
      setError(t("login.firstNameRequired"));
      return;
    }
    setStep("password");
  };

  const handleFinishRegister = async () => {
    setError(null);
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
      setStep("done");
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

  const handlePasswordLogin = async () => {
    setError(null);
    const e = signInEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) {
      setError(t("login.invalidEmail"));
      return;
    }
    if (!signInPassword) {
      setError(t("login.passwordRequired"));
      return;
    }
    setSubmitting(true);
    try {
      await loginWithPassword(e, signInPassword);
      const me = await refreshUser();
      await finishAuth(me ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError(t("login.badCredentials"));
      } else if (err instanceof ApiError && err.status === 429) {
        setError(t("login.rateLimitedSend"));
      } else {
        setError(t("login.networkError"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleBiometricLogin = async () => {
    if (!bioLabel) return;
    const ok = await promptBiometric(t("login.bioPrompt"));
    if (!ok) return;
    const token = await readBiometricToken(t("login.bioPrompt"));
    if (!token) {
      Alert.alert(t("login.bioFailedTitle"), t("login.bioFailedBody"));
      return;
    }
    setSubmitting(true);
    try {
      await loginWithToken(token);
      const me = await refreshUser();
      // Biometric users have already opted in once; skip the prompt and just route.
      if (me) routeAfterAuth(router, me as never);
      else router.replace("/");
    } catch {
      Alert.alert(t("login.bioFailedTitle"), t("login.bioFailedBody"));
    } finally {
      setSubmitting(false);
    }
  };

  const goBack = () => {
    if (step === "otp") setStep("phone");
    else if (step === "profile") setStep("phone");
    else if (step === "password") setStep("profile");
    else if (step === "done") router.replace("/(rider)/home");
  };

  const bioIcon = bioLabel === "face" ? "smile" : "shield";

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior="padding">
      <ScrollView
        contentContainerStyle={[styles.root, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}
        keyboardShouldPersistTaps="handled"
      >
        {step !== "phone" && step !== "done" && (
          <Pressable onPress={goBack} style={styles.back}>
            <Feather name={fonts.isRTL ? "arrow-right" : "arrow-left"} size={22} color={c.foreground} />
          </Pressable>
        )}

        <View style={styles.brandRow}>
          <Image
            source={require("../assets/images/biddi-logo.png")}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>

        {signInTab === "register" && step !== "done" && (
          <WizardProgress step={step} />
        )}

        {step === "phone" && (
          <>
            <View style={[styles.modeTabs, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Pressable
                style={[styles.modeTab, signInTab === "signin" && { backgroundColor: c.primary }]}
                onPress={() => switchTab("signin")}
              >
                <Text
                  style={[
                    styles.modeTabText,
                    {
                      color: signInTab === "signin" ? "#fff" : c.mutedForeground,
                      fontFamily: fonts.semiBold,
                    },
                  ]}
                >
                  {t("login.signIn")}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.modeTab, signInTab === "register" && { backgroundColor: c.primary }]}
                onPress={() => switchTab("register")}
              >
                <Text
                  style={[
                    styles.modeTabText,
                    {
                      color: signInTab === "register" ? "#fff" : c.mutedForeground,
                      fontFamily: fonts.semiBold,
                    },
                  ]}
                >
                  {t("login.register")}
                </Text>
              </Pressable>
            </View>

            {signInTab === "signin" && (
              <View style={styles.subTabs}>
                <Pressable
                  onPress={() => switchMode("phone")}
                  style={[
                    styles.subTab,
                    mode === "phone" && { borderBottomColor: c.primary, borderBottomWidth: 2 },
                  ]}
                >
                  <Text
                    style={{
                      color: mode === "phone" ? c.foreground : c.mutedForeground,
                      fontFamily: fonts.semiBold,
                      fontSize: 14,
                    }}
                  >
                    {t("login.tabPhone")}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => switchMode("email")}
                  style={[
                    styles.subTab,
                    mode === "email" && { borderBottomColor: c.primary, borderBottomWidth: 2 },
                  ]}
                >
                  <Text
                    style={{
                      color: mode === "email" ? c.foreground : c.mutedForeground,
                      fontFamily: fonts.semiBold,
                      fontSize: 14,
                    }}
                  >
                    {t("login.tabEmail")}
                  </Text>
                </Pressable>
              </View>
            )}

            <Text style={[styles.title, { color: c.foreground, fontFamily: fonts.bold }]}>
              {signInTab === "signin" ? t("login.welcomeBack") : t("login.createAccount")}
            </Text>
            <Text style={[styles.subtitle, { color: c.mutedForeground, fontFamily: fonts.regular, lineHeight: fonts.getBodyLineHeight(15) }]}>
              {signInTab === "signin" && mode === "email"
                ? t("login.emailHintSignIn")
                : signInTab === "signin"
                  ? t("login.phoneHintSignIn")
                  : t("login.phoneHintRegister")}
            </Text>

            {(signInTab === "register" || mode === "phone") && (
              <View style={[styles.phoneWrap, { backgroundColor: c.surface, borderColor: c.border }]}>
                <CountryCodePicker value={dial} onChange={handleDialChange} />
                <View style={[styles.divider, { backgroundColor: c.border }]} />
                <TextInput
                  value={phone}
                  onChangeText={(v) => {
                    setPhone(v);
                    setError(null);
                  }}
                  placeholder="6 12 34 56 78"
                  placeholderTextColor={c.mutedForeground}
                  keyboardType="phone-pad"
                  style={[styles.phoneInput, { color: c.foreground, fontFamily: fonts.medium }]}
                  autoFocus
                />
              </View>
            )}

            {signInTab === "signin" && mode === "email" && (
              <>
                <TextInput
                  value={signInEmail}
                  onChangeText={(v) => {
                    setSignInEmail(v);
                    setError(null);
                  }}
                  placeholder={t("login.emailPlaceholder")}
                  placeholderTextColor={c.mutedForeground}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[
                    styles.textInput,
                    { backgroundColor: c.surface, borderColor: c.border, color: c.foreground, fontFamily: fonts.medium },
                  ]}
                />
                <View style={{ height: 12 }} />
                <TextInput
                  value={signInPassword}
                  onChangeText={(v) => {
                    setSignInPassword(v);
                    setError(null);
                  }}
                  placeholder={t("login.passwordPlaceholder")}
                  placeholderTextColor={c.mutedForeground}
                  secureTextEntry
                  style={[
                    styles.textInput,
                    { backgroundColor: c.surface, borderColor: c.border, color: c.foreground, fontFamily: fonts.medium },
                  ]}
                />
              </>
            )}
          </>
        )}

        {step === "otp" && (
          <View>
            <Text style={[styles.title, { color: c.foreground, fontFamily: fonts.bold }]}>{t("login.enterCode")}</Text>
            <Text style={[styles.subtitle, { color: c.mutedForeground, fontFamily: fonts.regular, lineHeight: fonts.getBodyLineHeight(15) }]}>
              {t("login.sentTo", { phone: fullPhone })}
              {devCode ? `  ${t("login.demoCode", { code: devCode })}` : ""}
            </Text>
            <View style={styles.otpRow}>
              {otp.map((d, i) => (
                <TextInput
                  key={i}
                  ref={(el) => {
                    otpRefs.current[i] = el;
                  }}
                  value={d}
                  onChangeText={(txt) => handleOtpChange(txt, i)}
                  onKeyPress={({ nativeEvent }) => handleOtpKeyPress(nativeEvent.key, i)}
                  keyboardType="number-pad"
                  textContentType={i === 0 ? "oneTimeCode" : "none"}
                  autoComplete={i === 0 ? "one-time-code" : "off"}
                  importantForAutofill={i === 0 ? "yes" : "no"}
                  autoCorrect={false}
                  spellCheck={false}
                  placeholder=""
                  placeholderTextColor="transparent"
                  maxLength={1}
                  style={[
                    styles.otpBox,
                    {
                      backgroundColor: c.surface,
                      borderColor: d ? c.primary : c.border,
                      color: c.foreground,
                      fontFamily: fonts.bold,
                    },
                  ]}
                  autoFocus={i === 0}
                />
              ))}
            </View>
          </View>
        )}

        {step === "profile" && (
          <View>
            <Text style={[styles.title, { color: c.foreground, fontFamily: fonts.bold }]}>
              {t("login.whatsYourName")}
            </Text>
            <Text style={[styles.subtitle, { color: c.mutedForeground, fontFamily: fonts.regular, lineHeight: fonts.getBodyLineHeight(15) }]}>
              {t("login.nameHint")}
            </Text>
            <TextInput
              value={firstName}
              onChangeText={setFirstName}
              placeholder={t("login.firstName")}
              placeholderTextColor={c.mutedForeground}
              style={[
                styles.textInput,
                { backgroundColor: c.surface, borderColor: c.border, color: c.foreground, fontFamily: fonts.medium },
              ]}
              autoFocus
              autoCapitalize="words"
            />
            <View style={{ height: 12 }} />
            <TextInput
              value={lastName}
              onChangeText={setLastName}
              placeholder={t("login.lastName")}
              placeholderTextColor={c.mutedForeground}
              style={[
                styles.textInput,
                { backgroundColor: c.surface, borderColor: c.border, color: c.foreground, fontFamily: fonts.medium },
              ]}
              autoCapitalize="words"
            />
          </View>
        )}

        {step === "password" && (
          <View>
            <Text style={[styles.title, { color: c.foreground, fontFamily: fonts.bold }]}>
              {t("login.setupCredentials")}
            </Text>
            <Text style={[styles.subtitle, { color: c.mutedForeground, fontFamily: fonts.regular, lineHeight: fonts.getBodyLineHeight(15) }]}>
              {t("login.setupHint")}
            </Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder={t("login.emailPlaceholder")}
              placeholderTextColor={c.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                styles.textInput,
                { backgroundColor: c.surface, borderColor: c.border, color: c.foreground, fontFamily: fonts.medium },
              ]}
              autoFocus
            />
            <View style={{ height: 12 }} />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={t("login.passwordPlaceholder")}
              placeholderTextColor={c.mutedForeground}
              secureTextEntry
              style={[
                styles.textInput,
                { backgroundColor: c.surface, borderColor: c.border, color: c.foreground, fontFamily: fonts.medium },
              ]}
            />
            <View style={{ height: 12 }} />
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder={t("login.confirmPasswordPlaceholder")}
              placeholderTextColor={c.mutedForeground}
              secureTextEntry
              style={[
                styles.textInput,
                { backgroundColor: c.surface, borderColor: c.border, color: c.foreground, fontFamily: fonts.medium },
              ]}
            />
            <View style={{ height: 12 }} />
            <TextInput
              value={referralCode}
              onChangeText={(v) => setReferralCode(v.toUpperCase())}
              placeholder={t("login.referralPlaceholder")}
              placeholderTextColor={c.mutedForeground}
              autoCapitalize="characters"
              autoCorrect={false}
              style={[
                styles.textInput,
                { backgroundColor: c.surface, borderColor: c.border, color: c.foreground, fontFamily: fonts.medium },
              ]}
            />
            <Text style={[styles.helperText, { color: c.mutedForeground, fontFamily: fonts.regular, lineHeight: fonts.getBodyLineHeight(12) }]}>
              {t("login.passwordRules")}
            </Text>
          </View>
        )}

        {step === "done" && (
          <View>
            <Text style={[styles.title, { color: c.foreground, fontFamily: fonts.bold }]}>{t("login.welcomeAboard")}</Text>
            <Text style={[styles.subtitle, { color: c.mutedForeground, fontFamily: fonts.regular, lineHeight: fonts.getBodyLineHeight(15) }]}>
              {t("login.welcomeAboardHint")}
            </Text>
          </View>
        )}

        {error && (
          <View style={{ marginTop: 16 }}>
            <Text style={{ color: "#ef4444", fontFamily: fonts.medium }}>{error}</Text>
            {error === t("login.alreadyRegistered") && (
              <Pressable onPress={() => switchTab("signin")} style={{ marginTop: 6 }}>
                <Text style={{ color: c.primary, fontFamily: fonts.semiBold, fontSize: 14 }}>
                  {t("login.switchToSignIn")}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        <View style={styles.footer}>
          {step === "phone" && signInTab === "signin" && mode === "email" && (
            <Button
              label={t("login.signIn")}
              onPress={handlePasswordLogin}
              loading={submitting}
              disabled={!signInEmail || !signInPassword}
            />
          )}
          {step === "phone" && (signInTab === "register" || mode === "phone") && (
            <Button
              label={t("common.continue")}
              onPress={handleSendOtp}
              loading={submitting}
              disabled={digits.length < 6}
            />
          )}
          {step === "phone" && signInTab === "signin" && bioLabel && (
            <Pressable
              onPress={handleBiometricLogin}
              style={({ pressed }) => [
                styles.bioBtn,
                { borderColor: c.border, backgroundColor: c.surface, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Feather name={bioIcon} size={18} color={c.primary} />
              <Text style={{ color: c.foreground, fontFamily: fonts.semiBold }}>
                {bioLabel === "face" ? t("login.signInWithFaceId") : t("login.signInWithBiometric")}
              </Text>
            </Pressable>
          )}
          {step === "otp" && (
            <Button
              label={t("login.verify")}
              onPress={handleVerify}
              loading={submitting}
              disabled={otp.join("").length !== 4}
            />
          )}
          {step === "profile" && (
            <Button label={t("common.continue")} onPress={handleProfileNext} />
          )}
          {step === "password" && (
            <Button
              label={t("login.createAccount")}
              onPress={handleFinishRegister}
              loading={submitting}
              disabled={!email || !password || !confirmPassword}
            />
          )}
          {step === "done" && (
            <Button
              label={t("login.getStarted")}
              onPress={async () => {
                const me = await refreshUser();
                await finishAuth(me ?? null);
              }}
            />
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Renders a 4-segment progress bar for the registration wizard so users can
 * see how many steps remain. Steps in order: phone → otp → profile → password. */
function WizardProgress({ step }: { step: Step }) {
  const c = useColors();
  const fonts = useFontFamily();
  const { t } = useTranslation();
  const order: Step[] = ["phone", "otp", "profile", "password"];
  const idx = order.indexOf(step);
  const current = idx < 0 ? 0 : idx;
  const total = order.length;
  const labels: Record<Step, string> = {
    phone: t("login.stepPhone"),
    otp: t("login.stepVerify"),
    profile: t("login.stepProfile"),
    password: t("login.stepPassword"),
    done: "",
  };
  return (
    <View style={{ marginBottom: 20 }}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {order.map((_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: i <= current ? c.primary : c.border,
            }}
          />
        ))}
      </View>
      <Text
        style={{
          marginTop: 8,
          fontSize: 12,
          color: c.mutedForeground,
          fontFamily: fonts.medium,
        }}
      >
        {t("login.stepCounter", { current: current + 1, total })} · {labels[step]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, paddingHorizontal: 24 },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  brandRow: { alignItems: "center", marginBottom: 32 },
  logoImage: { width: 200, height: 72 },
  title: { fontSize: 28, marginBottom: 8 },
  subtitle: { fontSize: 15, marginBottom: 24, lineHeight: 22 },
  phoneWrap: {
    flexDirection: "row",
    alignItems: "center",
    height: 64,
    borderRadius: 18,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  divider: { width: 1, height: 28, marginHorizontal: 12 },
  phoneInput: { flex: 1, fontSize: 18, height: "100%" },
  textInput: {
    height: 56,
    borderRadius: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    fontSize: 16,
  },
  helperText: { marginTop: 10, fontSize: 12, lineHeight: 18 },
  otpRow: { flexDirection: "row", gap: 12, justifyContent: "space-between" },
  otpBox: {
    flex: 1,
    height: 72,
    borderRadius: 18,
    borderWidth: 2,
    fontSize: 28,
    textAlign: "center",
  },
  footer: { paddingTop: 24, gap: 12 },
  modeTabs: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: 1,
    padding: 4,
    marginBottom: 20,
    gap: 4,
  },
  modeTab: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  modeTabText: { fontSize: 15 },
  subTabs: {
    flexDirection: "row",
    marginBottom: 16,
    gap: 24,
  },
  subTab: {
    paddingBottom: 8,
  },
  bioBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
  },
});
