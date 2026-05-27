import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Animated,
  Platform,
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
import { useVehicle } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { api } from "@/lib/api";

interface UploadedDoc {
  type: string;
  url: string;
}

type PickedFile = {
  uri: string;
  mimeType: string;
  name: string;
};

class PermissionError extends Error {
  constructor() {
    super("permission_denied");
  }
}

class FileSizeError extends Error {
  constructor() {
    super("file_too_large");
  }
}

class StorageError extends Error {
  constructor(public readonly status: number) {
    super(`storage_write_failed:${status}`);
  }
}

async function uploadDocFile(docType: string, file: PickedFile): Promise<UploadedDoc> {
  const response = await fetch(file.uri);
  const blob = await response.blob();
  const size = blob.size;

  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  if (size > MAX_FILE_SIZE) {
    throw new FileSizeError();
  }

  const { uploadURL, objectPath } = await api<{ uploadURL: string; objectPath: string }>(
    "/storage/uploads/driver-request-url",
    {
      method: "POST",
      json: { name: file.name, size, contentType: file.mimeType },
    },
  );

  const putRes = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.mimeType },
    body: blob,
  });
  if (!putRes.ok) {
    throw new StorageError(putRes.status);
  }

  await api("/storage/uploads/driver-finalize", {
    method: "POST",
    json: { objectPath },
  });

  return { type: docType, url: `/api/storage${objectPath}` };
}

async function pickImage(): Promise<PickedFile | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== "granted") {
    throw new PermissionError();
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.85,
    allowsEditing: false,
  });

  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    mimeType: asset.mimeType ?? "image/jpeg",
    name: asset.fileName ?? "document.jpg",
  };
}

async function pickPdf(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "application/pdf",
    copyToCacheDirectory: true,
  });

  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    mimeType: asset.mimeType ?? "application/pdf",
    name: asset.name ?? "document.pdf",
  };
}

export default function BecomeDriverScreen() {
  const c = useColors();
  const fonts = useFontFamily();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { applyDriver } = useVehicle();
  const { t } = useTranslation();

  const DOC_TYPES = [
    { key: "license", label: t("becomeDriver.docLicense"), icon: "credit-card" as const },
    { key: "insurance", label: t("becomeDriver.docInsurance"), icon: "shield" as const },
    { key: "registration", label: t("becomeDriver.docRegistration"), icon: "file-text" as const },
    { key: "selfie", label: t("becomeDriver.docSelfie"), icon: "user" as const },
  ];

  const [step, setStep] = useState<"docs" | "vehicle" | "confirmed">("docs");
  const [uploadedDocs, setUploadedDocs] = useState<Record<string, UploadedDoc>>({});
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [color, setColor] = useState("");
  const [plate, setPlate] = useState("");
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [yearError, setYearError] = useState<string | null>(null);
  const [plateError, setPlateError] = useState<string | null>(null);

  const allUploaded = DOC_TYPES.every((d) => !!uploadedDocs[d.key]);

  const MAX_YEAR = new Date().getFullYear() + 1;

  const validateYear = (value: string): string | null => {
    const trimmed = value.trim();
    const num = parseInt(trimmed, 10);
    if (!/^\d{4}$/.test(trimmed) || num < 1960 || num > MAX_YEAR) {
      return t("becomeDriver.yearInvalid", { maxYear: MAX_YEAR });
    }
    return null;
  };

  const validatePlate = (value: string): string | null => {
    if (value.trim().length < 2) {
      return t("becomeDriver.plateInvalid");
    }
    return null;
  };

  const validateVehicle = (): boolean => {
    const yErr = validateYear(year);
    const pErr = validatePlate(plate);
    setYearError(yErr);
    setPlateError(pErr);
    return yErr === null && pErr === null;
  };

  const vehicleReady =
    make.trim().length > 0 && model.trim().length > 0 && color.trim().length > 0 &&
    validateYear(year) === null && validatePlate(plate) === null;

  const showPickerChoice = (onImage: () => void, onPdf: () => void) => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [t("common.cancel"), t("becomeDriver.choosePhoto"), t("becomeDriver.choosePdf")],
          cancelButtonIndex: 0,
        },
        (idx) => {
          if (idx === 1) onImage();
          else if (idx === 2) onPdf();
        },
      );
    } else {
      Alert.alert(t("becomeDriver.selectDocument"), t("becomeDriver.selectDocumentHint"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("becomeDriver.choosePhoto"), onPress: onImage },
        { text: t("becomeDriver.choosePdf"), onPress: onPdf },
      ]);
    }
  };

  const handleUploadError = (err: unknown) => {
    if (err instanceof PermissionError) {
      Alert.alert(t("becomeDriver.permissionNeeded"), t("becomeDriver.photoPermission"));
    } else if (err instanceof FileSizeError) {
      Alert.alert(t("becomeDriver.uploadFailedTitle"), t("becomeDriver.fileTooLarge"));
    } else {
      Alert.alert(t("becomeDriver.uploadFailedTitle"), t("becomeDriver.uploadFailed"));
    }
  };

  const handleUpload = (docKey: string) => {
    if (uploadingKey) return;

    const doUpload = async (file: PickedFile | null) => {
      if (!file) return;
      setUploadingKey(docKey);
      try {
        const doc = await uploadDocFile(docKey, file);
        setUploadedDocs((prev) => ({ ...prev, [docKey]: doc }));
      } catch (err) {
        handleUploadError(err);
      } finally {
        setUploadingKey(null);
      }
    };

    showPickerChoice(
      async () => { try { await doUpload(await pickImage()); } catch (err) { handleUploadError(err); } },
      async () => { try { await doUpload(await pickPdf()); } catch (err) { handleUploadError(err); } },
    );
  };

  const handleApply = async () => {
    if (!validateVehicle()) return;
    setApplyError(null);
    setApplying(true);
    try {
      const docs = Object.values(uploadedDocs);
      await applyDriver({
        make: make.trim(),
        model: model.trim(),
        year: year.trim(),
        color: color.trim(),
        plate: plate.trim()
      }, docs);
      setStep("confirmed");
    } catch {
      setApplyError(t("becomeDriver.applyError"));
    } finally {
      setApplying(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior="padding"
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} disabled={step === "confirmed"}>
          <Feather name="x" size={22} color={step === "confirmed" ? "transparent" : c.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.foreground, fontFamily: fonts.semiBold }]}>{t("becomeDriver.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      {step !== "confirmed" && (
        <View style={[styles.progress, { backgroundColor: c.surface }]}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: c.primary, width: step === "docs" ? "50%" : "100%" },
            ]}
          />
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ paddingBottom: 24, paddingHorizontal: 24, paddingTop: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {step === "confirmed" ? (
          <ConfirmedView c={c} fonts={fonts} t={t} />
        ) : step === "docs" ? (
          <>
            <Text style={[styles.title, { color: c.foreground, fontFamily: fonts.bold }]}>{t("becomeDriver.uploadDocs")}</Text>
            <Text style={[styles.subtitle, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
              {t("becomeDriver.uploadDocsHint")}
            </Text>

            <View style={{ gap: 10 }}>
              {DOC_TYPES.map((d) => {
                const isUp = !!uploadedDocs[d.key];
                const isUploading = uploadingKey === d.key;
                return (
                  <Pressable
                    key={d.key}
                    onPress={() => handleUpload(d.key)}
                    style={({ pressed }) => [
                      styles.docRow,
                      {
                        backgroundColor: isUp ? c.primarySoft : c.surface,
                        borderColor: isUp ? c.primary : c.border,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.docIcon,
                        { backgroundColor: isUp ? c.primary : c.background },
                      ]}
                    >
                      {isUploading ? (
                        <ActivityIndicator size="small" color={c.primary} />
                      ) : (
                        <Feather
                          name={isUp ? "check" : d.icon}
                          size={18}
                          color={isUp ? "#fff" : c.primary}
                        />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.docLabel, { color: c.foreground, fontFamily: fonts.semiBold }]}>{d.label}</Text>
                      <Text style={[styles.docHint, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                        {isUploading
                          ? t("becomeDriver.uploading")
                          : isUp
                            ? t("becomeDriver.uploadedReplace")
                            : t("becomeDriver.tapToUpload")}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : (
          <>
            <Text style={[styles.title, { color: c.foreground, fontFamily: fonts.bold }]}>{t("becomeDriver.yourVehicle")}</Text>
            <Text style={[styles.subtitle, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
              {t("becomeDriver.yourVehicleHint")}
            </Text>

            <View style={styles.formRow}>
              <Field label={t("personalInfo.make")} value={make} onChangeText={setMake} placeholder={t("becomeDriver.makePlaceholder")} />
              <Field label={t("personalInfo.model")} value={model} onChangeText={setModel} placeholder={t("becomeDriver.modelPlaceholder")} />
            </View>
            <View style={styles.formRow}>
              <Field
                label={t("personalInfo.year")}
                value={year}
                onChangeText={(v) => { setYear(v); setYearError(null); }}
                onBlur={() => setYearError(validateYear(year))}
                placeholder={t("becomeDriver.yearPlaceholder")}
                keyboardType="number-pad"
                error={yearError}
              />
              <Field label={t("personalInfo.color")} value={color} onChangeText={setColor} placeholder={t("becomeDriver.colorPlaceholder")} />
            </View>
            <Field
              label={t("personalInfo.plate")}
              value={plate}
              onChangeText={(v) => { setPlate(v.toUpperCase()); setPlateError(null); }}
              onBlur={() => setPlateError(validatePlate(plate))}
              placeholder={t("becomeDriver.platePlaceholder")}
              error={plateError}
            />
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        {step === "confirmed" ? (
          <Button
            label={t("becomeDriver.confirmedCta")}
            onPress={() => router.replace("/profile")}
          />
        ) : step === "docs" ? (
          <Button
            label={t("common.continue")}
            disabled={!allUploaded || uploadingKey !== null}
            onPress={() => setStep("vehicle")}
          />
        ) : (
          <>
            {applyError ? (
              <Text style={{ color: "red", marginBottom: 8, textAlign: "center", fontSize: 14 }}>
                {applyError}
              </Text>
            ) : null}
            <Button
              label={applying ? t("common.submitting") : t("becomeDriver.submitApplication")}
              disabled={!vehicleReady || applying}
              onPress={handleApply}
            />
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function ConfirmedView({
  c,
  fonts,
  t,
}: {
  c: ReturnType<typeof useColors>;
  fonts: ReturnType<typeof useFontFamily>;
  t: (key: string) => string;
}) {
  const iconScale = useRef(new Animated.Value(0)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(iconScale, {
        toValue: 1,
        tension: 60,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.delay(100),
      Animated.parallel([
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(textTranslateY, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseScale, {
            toValue: 1.06,
            duration: 420,
            useNativeDriver: true,
          }),
          Animated.timing(pulseScale, {
            toValue: 1,
            duration: 420,
            useNativeDriver: true,
          }),
        ]),
        { iterations: 2 },
      ).start();
    });
  }, [iconScale, pulseScale, textOpacity, textTranslateY]);

  return (
    <View style={styles.confirmedContainer}>
      <Animated.View
        style={[
          styles.confirmedIcon,
          { backgroundColor: c.primarySoft, transform: [{ scale: iconScale }, { scale: pulseScale }] },
        ]}
      >
        <Feather name="check-circle" size={48} color={c.primary} />
      </Animated.View>
      <Animated.Text
        style={[
          styles.confirmedTitle,
          {
            color: c.foreground,
            fontFamily: fonts.bold,
            opacity: textOpacity,
            transform: [{ translateY: textTranslateY }],
          },
        ]}
      >
        {t("becomeDriver.confirmedTitle")}
      </Animated.Text>
      <Animated.Text
        style={[
          styles.confirmedBody,
          {
            color: c.mutedForeground,
            fontFamily: fonts.regular,
            opacity: textOpacity,
            transform: [{ translateY: textTranslateY }],
          },
        ]}
      >
        {t("becomeDriver.confirmedBody")}
      </Animated.Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  onBlur,
  placeholder,
  keyboardType,
  error,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  keyboardType?: "default" | "number-pad";
  error?: string | null;
}) {
  const c = useColors();
  const fonts = useFontFamily();
  return (
    <View style={{ flex: 1, marginBottom: 12 }}>
      <Text style={[styles.fieldLabel, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        placeholder={placeholder}
        placeholderTextColor={c.mutedForeground}
        keyboardType={keyboardType ?? "default"}
        style={[
          styles.field,
          {
            backgroundColor: c.surface,
            borderColor: error ? "#e53e3e" : c.border,
            color: c.foreground,
            fontFamily: fonts.medium,
            textAlign: fonts.isRTL ? "right" : "left",
          },
        ]}
      />
      {error ? (
        <Text style={[styles.fieldError, { fontFamily: fonts.regular }]}>{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 17 },
  progress: { height: 4, marginHorizontal: 24, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 2 },
  title: { fontSize: 28, marginBottom: 6 },
  subtitle: { fontSize: 14, marginBottom: 24 },
  docRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  docIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  docLabel: { fontSize: 15 },
  docHint: { fontSize: 12, marginTop: 2 },
  formRow: { flexDirection: "row", gap: 10 },
  fieldLabel: {
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 6,
  },
  field: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  footer: { paddingHorizontal: 24, paddingTop: 12 },
  confirmedContainer: {
    flex: 1,
    alignItems: "center",
    paddingTop: 48,
    paddingHorizontal: 8,
  },
  confirmedIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  confirmedTitle: {
    fontSize: 26,
    textAlign: "center",
    marginBottom: 12,
  },
  confirmedBody: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  fieldError: { color: "#e53e3e", fontSize: 12, marginTop: 4 },
});
