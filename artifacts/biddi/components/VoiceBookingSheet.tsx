import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  NativeEventEmitter,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TurboModuleRegistry,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import * as Speech from "expo-speech";

import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { useCurrentLocation } from "@/lib/location";
import {
  fetchAutocomplete,
  fetchPlaceDetails,
  newSessionToken,
} from "@/lib/maps";
import type { Place } from "@/lib/types";
import i18n from "@/i18n";

// ---------------------------------------------------------------------------
// Native module access — zero crash guarantee in Expo Go.
//
// TurboModuleRegistry.get() is the non-throwing variant of getEnforcing().
// It returns null when 'ExpoSpeechRecognition' isn't registered (Expo Go),
// so voice booking degrades gracefully without any try/catch required.
// We access it only through react-native builtins so this file has zero
// dependency on expo-speech-recognition and Metro never pulls that package
// into the bundle through this file.
// ---------------------------------------------------------------------------
interface SpeechRecognitionNative {
  isRecognitionAvailable(): boolean;
  requestPermissionsAsync(): Promise<{ granted: boolean; status: string }>;
  start(options: {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
  }): void;
  stop(): void;
  abort(): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SpeechNative: SpeechRecognitionNative | null = (TurboModuleRegistry as any).get(
  "ExpoSpeechRecognition",
);

// NativeEventEmitter requires a non-null native module on iOS.
const speechEmitter: NativeEventEmitter | null = SpeechNative
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ? new NativeEventEmitter(SpeechNative as any)
  : null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type Phase =
  | "idle"
  | "unavailable"
  | "permission_denied"
  | "listening"
  | "processing"
  | "confirm"
  | "no_match"
  | "error";

const PREFIX_RE: Record<string, RegExp> = {
  en: /^(take me to|go to|i want to go to|i'd like to go to|book a ride to|drop me at|drive me to|get me to|i need to go to|bring me to|navigate to|i'm going to|i am going to)\s+/i,
  ar: /^(خذني إلى|أريد الذهاب إلى|اذهب إلى|روحني إلى|وصلني إلى|أبغى أروح إلى|ابغا اروح|خذني|وصلني|روحني)\s*/,
  fr: /^(emmène-moi à|je veux aller à|aller à|conduis-moi à|amène-moi à|je vais à)\s+/i,
};

function stripPrefix(text: string, locale: string): string {
  const re = PREFIX_RE[locale] ?? PREFIX_RE["en"];
  const m = text.match(re);
  return m ? text.slice(m[0].length).trim() : text.trim();
}

function langForLocale(locale: string): string {
  if (locale.startsWith("ar")) return "ar-SA";
  if (locale.startsWith("fr")) return "fr-FR";
  return "en-US";
}

// ---------------------------------------------------------------------------
// SpeechCore — inner component that manages recognition lifecycle + events.
// Only mounted when isAvailable is true (i.e. the native module exists).
// Uses EventEmitter subscriptions instead of useSpeechRecognitionEvent so
// that this file has zero dependency on expo-speech-recognition.
// ---------------------------------------------------------------------------
function SpeechCore({
  active,
  lang,
  onResult,
  onEnd,
  onSpeechError,
}: {
  active: boolean;
  lang: string;
  onResult: (transcript: string, isFinal: boolean) => void;
  onEnd: () => void;
  onSpeechError: (msg: string) => void;
}) {
  const resultRef = useRef(onResult);
  const endRef = useRef(onEnd);
  const errorRef = useRef(onSpeechError);
  resultRef.current = onResult;
  endRef.current = onEnd;
  errorRef.current = onSpeechError;

  // Subscribe to native events for the lifetime of this component.
  useEffect(() => {
    if (!speechEmitter) return;
    const subs = [
      speechEmitter.addListener(
        "result",
        (e: { isFinal?: boolean; results?: { transcript: string }[]; transcript?: string }) => {
          const text = e.results?.[0]?.transcript ?? e.transcript ?? "";
          resultRef.current(text, e.isFinal ?? false);
        },
      ),
      speechEmitter.addListener("end", () => {
        endRef.current();
      }),
      speechEmitter.addListener(
        "error",
        (e: { error?: string; message?: string }) => {
          errorRef.current(e.message ?? e.error ?? "Speech recognition error");
        },
      ),
    ];
    return () => {
      subs.forEach((s) => s.remove());
    };
  }, []);

  // Start / stop recognition when `active` changes.
  useEffect(() => {
    if (!active || !SpeechNative) return;
    SpeechNative.start({ lang, interimResults: true, continuous: false });
    return () => {
      try {
        SpeechNative?.abort();
      } catch {
        /* ignore */
      }
    };
  }, [active, lang]);

  return null;
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------
export interface VoiceBookingSheetProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (place: Place) => void;
}

export function VoiceBookingSheet({
  visible,
  onClose,
  onConfirm,
}: VoiceBookingSheetProps) {
  const c = useColors();
  const fonts = useFontFamily();
  const { t } = useTranslation();
  const { location } = useCurrentLocation();

  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [confirmedPlace, setConfirmedPlace] = useState<Place | null>(null);
  // Check once at mount: is the native module present and recognition available?
  const [isAvailable] = useState<boolean>(
    () => SpeechNative?.isRecognitionAvailable() ?? false,
  );
  const sessionRef = useRef(newSessionToken());

  // Pulsing mic animation
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (phase === "listening") {
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.3,
            duration: 650,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 650,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
      pulseLoop.current.start();
    } else {
      pulseLoop.current?.stop();
      pulseAnim.setValue(1);
    }
  }, [phase, pulseAnim]);

  // Reset and start flow whenever sheet opens
  useEffect(() => {
    if (!visible) return;
    setTranscript("");
    setConfirmedPlace(null);
    sessionRef.current = newSessionToken();

    if (!isAvailable) {
      setPhase("unavailable");
      return;
    }

    (async () => {
      const { granted } = await SpeechNative!.requestPermissionsAsync();
      if (!granted) {
        setPhase("permission_denied");
        return;
      }
      setPhase("listening");
    })();
  }, [visible, isAvailable]);

  // When sheet closes, reset phase
  useEffect(() => {
    if (!visible) {
      setPhase("idle");
    }
  }, [visible]);

  const handleResult = useCallback((text: string, isFinal: boolean) => {
    setTranscript(text);
    if (isFinal && text.trim()) {
      setPhase("processing");
    }
  }, []);

  const handleEnd = useCallback(() => {
    setTranscript((cur) => {
      if (cur.trim()) {
        setPhase((p) => (p === "listening" ? "processing" : p));
      } else {
        setPhase((p) => (p === "listening" ? "no_match" : p));
      }
      return cur;
    });
  }, []);

  const handleSpeechError = useCallback((msg: string) => {
    const isNoInput = msg.includes("no-speech") || msg.includes("no_speech");
    if (isNoInput) {
      setPhase((p) => (p === "listening" ? "no_match" : p));
    } else {
      setPhase((p) => (p === "listening" ? "error" : p));
    }
  }, []);

  // Process transcript when phase changes to 'processing'
  useEffect(() => {
    if (phase !== "processing") return;

    (async () => {
      const stripped = stripPrefix(transcript, i18n.language ?? "en");
      if (!stripped) {
        setPhase("no_match");
        return;
      }

      try {
        const results = await fetchAutocomplete(
          stripped,
          location ? { lat: location.lat, lng: location.lng } : undefined,
          sessionRef.current,
        );
        if (results.length === 0) {
          setPhase("no_match");
          return;
        }

        const top = results[0];
        const details = await fetchPlaceDetails(top.placeId, sessionRef.current);
        sessionRef.current = newSessionToken();

        if (!details) {
          setPhase("no_match");
          return;
        }

        setConfirmedPlace({
          label: top.primary,
          address: details.address,
          lat: details.lat,
          lng: details.lng,
          googlePlaceId: details.placeId,
        });
        setPhase("confirm");
      } catch {
        setPhase("no_match");
      }
    })();
  }, [phase, transcript, location]);

  const handleConfirm = useCallback(() => {
    if (!confirmedPlace) return;
    // Speak a brief TTS confirmation (best-effort)
    const label = confirmedPlace.label;
    const lang = i18n.language ?? "en";
    let msg = `Searching drivers to ${label}`;
    if (lang === "ar") msg = `جارٍ البحث عن سائقين إلى ${label}`;
    else if (lang === "fr") msg = `Recherche de chauffeurs vers ${label}`;
    Speech.speak(msg, { language: langForLocale(lang) });
    onConfirm(confirmedPlace);
  }, [confirmedPlace, onConfirm]);

  const handleTryAgain = useCallback(() => {
    setTranscript("");
    setConfirmedPlace(null);
    setPhase("listening");
  }, []);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <View style={[styles.sheet, { backgroundColor: c.background }]}>
          {/* Close handle */}
          <View style={[styles.handle, { backgroundColor: c.border }]} />

          {/* Close button */}
          <Pressable
            onPress={onClose}
            style={[styles.closeBtn, { backgroundColor: c.surface }]}
            hitSlop={10}
          >
            <Feather name="x" size={18} color={c.foreground} />
          </Pressable>

          {/* Main content */}
          {phase === "unavailable" && (
            <InfoView
              icon="mic-off"
              color={c.mutedForeground}
              title={t("riderHome.voiceNotAvailable", {
                defaultValue: "Voice booking unavailable",
              })}
              subtitle={t("riderHome.voiceDevBuildRequired", {
                defaultValue:
                  "Voice booking requires an EAS dev build. It does not work in Expo Go.",
              })}
              c={c}
              fonts={fonts}
            />
          )}

          {phase === "permission_denied" && (
            <InfoView
              icon="mic-off"
              color="#EF4444"
              title={t("riderHome.voicePermissionDenied", {
                defaultValue: "Microphone access denied",
              })}
              subtitle={t("riderHome.voicePermissionHint", {
                defaultValue:
                  "Enable microphone access in your device Settings to use voice booking.",
              })}
              c={c}
              fonts={fonts}
            />
          )}

          {(phase === "listening" || phase === "idle") && (
            <View style={styles.listenContent}>
              <Text
                style={[
                  styles.hint,
                  { color: c.mutedForeground, fontFamily: fonts.medium },
                ]}
              >
                {t("riderHome.voiceHint", {
                  defaultValue: "Say where you want to go",
                })}
              </Text>

              <Animated.View
                style={[
                  styles.micRing,
                  {
                    backgroundColor: c.primarySoft,
                    transform: [{ scale: pulseAnim }],
                  },
                ]}
              >
                <View
                  style={[
                    styles.micCircle,
                    { backgroundColor: c.primary },
                  ]}
                >
                  <Feather name="mic" size={32} color="#fff" />
                </View>
              </Animated.View>

              {transcript !== "" ? (
                <Text
                  style={[
                    styles.transcript,
                    { color: c.foreground, fontFamily: fonts.semiBold },
                  ]}
                  numberOfLines={3}
                >
                  {transcript}
                </Text>
              ) : (
                <Text
                  style={[
                    styles.transcript,
                    { color: c.mutedForeground, fontFamily: fonts.regular },
                  ]}
                >
                  {t("riderHome.voiceListening", { defaultValue: "Listening…" })}
                </Text>
              )}

              <Pressable
                onPress={onClose}
                style={[styles.cancelBtn, { borderColor: c.border }]}
              >
                <Text
                  style={[
                    styles.cancelBtnText,
                    { color: c.foreground, fontFamily: fonts.medium },
                  ]}
                >
                  {t("common.cancel")}
                </Text>
              </Pressable>
            </View>
          )}

          {phase === "processing" && (
            <View style={styles.listenContent}>
              <Text
                style={[
                  styles.hint,
                  { color: c.mutedForeground, fontFamily: fonts.medium },
                ]}
              >
                {t("riderHome.voiceProcessing", {
                  defaultValue: "Finding that place…",
                })}
              </Text>
              <View
                style={[styles.micCircle, { backgroundColor: c.surface }]}
              >
                <ActivityIndicator size="large" color={c.primary} />
              </View>
              <Text
                style={[
                  styles.transcript,
                  { color: c.foreground, fontFamily: fonts.semiBold },
                ]}
                numberOfLines={3}
              >
                {transcript}
              </Text>
            </View>
          )}

          {phase === "no_match" && (
            <View style={styles.listenContent}>
              <InfoView
                icon="alert-circle"
                color="#F59E0B"
                title={t("riderHome.voiceNoMatch", {
                  defaultValue: "Couldn't find that place",
                })}
                subtitle={
                  transcript
                    ? `"${transcript}"`
                    : t("riderHome.voiceNoMatchHint", {
                        defaultValue: "Try saying a clearer destination.",
                      })
                }
                c={c}
                fonts={fonts}
              />
              <View style={styles.retryRow}>
                <Pressable
                  onPress={handleTryAgain}
                  style={[styles.retryBtn, { backgroundColor: c.primary }]}
                >
                  <Feather name="mic" size={16} color="#fff" />
                  <Text
                    style={[
                      styles.retryBtnText,
                      { color: "#fff", fontFamily: fonts.semiBold },
                    ]}
                  >
                    {t("riderHome.voiceTryAgain", { defaultValue: "Try again" })}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={onClose}
                  style={[styles.cancelBtn, { borderColor: c.border }]}
                >
                  <Text
                    style={[
                      styles.cancelBtnText,
                      { color: c.foreground, fontFamily: fonts.medium },
                    ]}
                  >
                    {t("common.cancel")}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {phase === "error" && (
            <View style={styles.listenContent}>
              <InfoView
                icon="alert-circle"
                color="#EF4444"
                title={t("riderHome.voiceError", {
                  defaultValue: "Something went wrong",
                })}
                subtitle={t("riderHome.voiceErrorHint", {
                  defaultValue: "Please try again.",
                })}
                c={c}
                fonts={fonts}
              />
              <View style={styles.retryRow}>
                <Pressable
                  onPress={handleTryAgain}
                  style={[styles.retryBtn, { backgroundColor: c.primary }]}
                >
                  <Feather name="mic" size={16} color="#fff" />
                  <Text
                    style={[
                      styles.retryBtnText,
                      { color: "#fff", fontFamily: fonts.semiBold },
                    ]}
                  >
                    {t("riderHome.voiceTryAgain", { defaultValue: "Try again" })}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {phase === "confirm" && confirmedPlace && (
            <View style={styles.confirmContent}>
              <View style={[styles.destCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                <View style={[styles.destIcon, { backgroundColor: c.primarySoft }]}>
                  <Feather name="map-pin" size={20} color={c.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.destLabel,
                      { color: c.foreground, fontFamily: fonts.bold },
                    ]}
                    numberOfLines={1}
                  >
                    {confirmedPlace.label}
                  </Text>
                  <Text
                    style={[
                      styles.destAddress,
                      { color: c.mutedForeground, fontFamily: fonts.regular },
                    ]}
                    numberOfLines={2}
                  >
                    {confirmedPlace.address}
                  </Text>
                </View>
              </View>

              <Text
                style={[
                  styles.confirmQuestion,
                  { color: c.mutedForeground, fontFamily: fonts.medium },
                ]}
              >
                {t("riderHome.voiceGoHere", { defaultValue: "Book a ride here?" })}
              </Text>

              <Pressable
                onPress={handleConfirm}
                style={[styles.confirmBtn, { backgroundColor: c.primary }]}
              >
                <Feather name="navigation" size={18} color="#fff" />
                <Text
                  style={[
                    styles.confirmBtnText,
                    { color: "#fff", fontFamily: fonts.bold },
                  ]}
                >
                  {t("riderHome.voiceConfirm", { defaultValue: "Book this ride" })}
                </Text>
              </Pressable>

              <Pressable
                onPress={handleTryAgain}
                style={[styles.cancelBtn, { borderColor: c.border }]}
              >
                <Feather name="mic" size={14} color={c.mutedForeground} />
                <Text
                  style={[
                    styles.cancelBtnText,
                    { color: c.foreground, fontFamily: fonts.medium },
                  ]}
                >
                  {t("riderHome.voiceTryAgain", { defaultValue: "Try again" })}
                </Text>
              </Pressable>
            </View>
          )}

          {/* SpeechCore only mounts when native speech recognition is available */}
          {isAvailable && (
            <SpeechCore
              active={phase === "listening"}
              lang={langForLocale(i18n.language ?? "en")}
              onResult={handleResult}
              onEnd={handleEnd}
              onSpeechError={handleSpeechError}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

function InfoView({
  icon,
  color,
  title,
  subtitle,
  c,
  fonts,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  color: string;
  title: string;
  subtitle: string;
  c: ReturnType<typeof useColors>;
  fonts: ReturnType<typeof useFontFamily>;
}) {
  return (
    <View style={styles.infoContent}>
      <View style={[styles.infoIcon, { backgroundColor: color + "22" }]}>
        <Feather name={icon} size={32} color={color} />
      </View>
      <Text
        style={[
          styles.infoTitle,
          { color: c.foreground, fontFamily: fonts.bold },
        ]}
      >
        {title}
      </Text>
      <Text
        style={[
          styles.infoSubtitle,
          { color: c.mutedForeground, fontFamily: fonts.regular },
        ]}
        numberOfLines={4}
      >
        {subtitle}
      </Text>
    </View>
  );
}

const MIC_CIRCLE = 80;
const MIC_RING = 120;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "transparent",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 36 : 24,
    minHeight: 280,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  closeBtn: {
    position: "absolute",
    top: 20,
    end: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  listenContent: {
    alignItems: "center",
    paddingTop: 8,
    gap: 20,
  },
  hint: {
    fontSize: 14,
    textAlign: "center",
  },
  micRing: {
    width: MIC_RING,
    height: MIC_RING,
    borderRadius: MIC_RING / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  micCircle: {
    width: MIC_CIRCLE,
    height: MIC_CIRCLE,
    borderRadius: MIC_CIRCLE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  transcript: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
    minHeight: 48,
    paddingHorizontal: 8,
  },
  cancelBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
  },
  cancelBtnText: {
    fontSize: 14,
  },
  retryRow: {
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    width: "100%",
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 24,
    width: "100%",
  },
  retryBtnText: {
    fontSize: 15,
  },
  confirmContent: {
    paddingTop: 8,
    gap: 16,
  },
  destCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  destIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  destLabel: {
    fontSize: 16,
    marginBottom: 2,
  },
  destAddress: {
    fontSize: 13,
    lineHeight: 18,
  },
  confirmQuestion: {
    fontSize: 13,
    textAlign: "center",
  },
  confirmBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 24,
  },
  confirmBtnText: {
    fontSize: 16,
  },
  infoContent: {
    alignItems: "center",
    paddingTop: 8,
    gap: 12,
    paddingHorizontal: 16,
  },
  infoIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  infoTitle: {
    fontSize: 17,
    textAlign: "center",
  },
  infoSubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 4,
  },
});
