import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { useAuth, useVehicle } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { api } from "@/lib/api";

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

const DOC_TYPES = [
  { key: "license", icon: "credit-card" as const },
  { key: "insurance", icon: "shield" as const },
  { key: "registration", icon: "file-text" as const },
  { key: "selfie", icon: "user" as const },
];

interface UploadedDoc {
  type: string;
  url: string;
}

type PickedFile = {
  uri: string;
  mimeType: string;
  name: string;
};

async function uploadDocFile(
  docType: string,
  file: PickedFile,
  fileTooLargeMsg: string,
  uploadErrorMsg: string,
): Promise<UploadedDoc> {
  const response = await fetch(file.uri);
  const blob = await response.blob();
  const size = blob.size;

  if (size > MAX_FILE_BYTES) {
    throw new Error(fileTooLargeMsg);
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
    throw new Error(uploadErrorMsg);
  }

  await api("/storage/uploads/driver-finalize", {
    method: "POST",
    json: { objectPath },
  });

  return { type: docType, url: `/api/storage${objectPath}` };
}

async function pickImage(permissionTitle: string, permissionMsg: string): Promise<PickedFile | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== "granted") {
    Alert.alert(permissionTitle, permissionMsg);
    return null;
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

function showPickerChoice(
  cancelLabel: string,
  choosePhotoLabel: string,
  choosePdfLabel: string,
  selectDocLabel: string,
  selectDocHint: string,
  onImage: () => void,
  onPdf: () => void,
) {
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [cancelLabel, choosePhotoLabel, choosePdfLabel],
        cancelButtonIndex: 0,
      },
      (idx) => {
        if (idx === 1) onImage();
        else if (idx === 2) onPdf();
      },
    );
  } else {
    Alert.alert(selectDocLabel, selectDocHint, [
      { text: cancelLabel, style: "cancel" },
      { text: choosePhotoLabel, onPress: onImage },
      { text: choosePdfLabel, onPress: onPdf },
    ]);
  }
}

export default function ReuploadDocsScreen() {
  const c = useColors();
  const fonts = useFontFamily();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { submittedDocs, updateDocs } = useVehicle();
  const { t } = useTranslation();

  React.useEffect(() => {
    if (user && user.driverStatus !== "rejected") {
      router.replace("/profile");
    }
  }, [user]);

  const [uploadedDocs, setUploadedDocs] = useState<Record<string, UploadedDoc>>({});
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const docInfoMap = React.useMemo(() => {
    const map: Record<string, { status?: string; rejectionReason?: string }> = {};
    for (const d of submittedDocs) {
      map[d.type] = { status: d.status, rejectionReason: d.rejectionReason };
    }
    return map;
  }, [submittedDocs]);

  const requiredDocKeys = DOC_TYPES.filter((d) => {
    const info = docInfoMap[d.key];
    return !info || info.status !== "approved";
  }).map((d) => d.key);

  const allRequiredUploaded = requiredDocKeys.every((k) => !!uploadedDocs[k]);

  const handleUpload = (docKey: string) => {
    if (uploadingKey || submitting) return;

    const doUpload = async (file: PickedFile | null) => {
      if (!file) return;
      setUploadingKey(docKey);
      try {
        const doc = await uploadDocFile(docKey, file, t("reuploadDocs.fileTooLarge"), t("reuploadDocs.uploadError"));
        setUploadedDocs((prev) => ({ ...prev, [docKey]: doc }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : t("reuploadDocs.uploadError");
        Alert.alert(t("becomeDriver.uploadFailedTitle"), msg);
      } finally {
        setUploadingKey(null);
      }
    };

    showPickerChoice(
      t("common.cancel"),
      t("becomeDriver.choosePhoto"),
      t("becomeDriver.choosePdf"),
      t("becomeDriver.selectDocument"),
      t("becomeDriver.selectPhotoOrPdf"),
      () => pickImage(t("becomeDriver.permissionNeeded"), t("becomeDriver.photoPermission")).then(doUpload),
      () => pickPdf().then(doUpload),
    );
  };

  const handleResubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const newUploads = Object.values(uploadedDocs);
      const newUploadTypes = new Set(newUploads.map((d) => d.type));
      const preserved = submittedDocs
        .filter((d) => d.status === "approved" && !newUploadTypes.has(d.type))
        .map((d) => ({ type: d.type, url: d.url }));
      await updateDocs([...preserved, ...newUploads]);
      router.replace("/profile");
    } catch {
      Alert.alert(t("reuploadDocs.submissionFailedTitle"), t("reuploadDocs.submissionFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const hasAnyRejected = DOC_TYPES.some((d) => docInfoMap[d.key]?.status === "rejected");

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="x" size={22} color={c.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.foreground, fontFamily: fonts.semiBold }]}>
          {t("reuploadDocs.title")}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 24, paddingHorizontal: 24, paddingTop: 24 }}
      >
        <View style={[styles.banner, { backgroundColor: "#fdf0ef", borderColor: "#c0392b" }]}>
          <Feather name="alert-circle" size={18} color="#c0392b" />
          <Text style={[styles.bannerText, { color: "#7b1a11", fontFamily: fonts.medium, textAlign: fonts.isRTL ? "right" : "left" }]}>
            {hasAnyRejected
              ? t("reuploadDocs.bannerSomeRejected")
              : t("reuploadDocs.bannerAllRejected")}
          </Text>
        </View>

        <Text style={[styles.sectionLabel, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>
          {t("reuploadDocs.requiredDocuments")}
        </Text>

        <View style={{ gap: 10 }}>
          {DOC_TYPES.map((d) => {
            const info = docInfoMap[d.key];
            const docStatus = info?.status;
            const rejectionReason = info?.rejectionReason;
            const isAccepted = docStatus === "approved";
            const isRejected = docStatus === "rejected";
            const isNewlyUploaded = !!uploadedDocs[d.key];
            const isUploading = uploadingKey === d.key;
            const docLabel = t(`becomeDriver.${d.key}`);

            if (isAccepted && !isNewlyUploaded) {
              return (
                <View
                  key={d.key}
                  style={[
                    styles.docRow,
                    {
                      backgroundColor: "#f0faf4",
                      borderColor: "#27ae60",
                      opacity: 0.85,
                    },
                  ]}
                >
                  <View style={[styles.docIcon, { backgroundColor: "#27ae60" }]}>
                    <Feather name="check" size={18} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.docLabel, { color: c.foreground, fontFamily: fonts.semiBold }]}>{docLabel}</Text>
                    <Text style={[styles.docHint, { color: "#27ae60", fontFamily: fonts.medium }]}>
                      {t("reuploadDocs.acceptedHint")}
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: "#e6f9ef", borderColor: "#27ae60" }]}>
                    <Text style={[styles.statusBadgeText, { color: "#1a8a45", fontFamily: fonts.semiBold }]}>
                      {t("reuploadDocs.accepted")}
                    </Text>
                  </View>
                </View>
              );
            }

            const showRejectedBadge = isRejected && !isNewlyUploaded && user?.driverStatus === "rejected";

            return (
              <View key={d.key}>
                <Pressable
                  onPress={() => handleUpload(d.key)}
                  disabled={submitting}
                  style={({ pressed }) => [
                    styles.docRow,
                    {
                      backgroundColor: isNewlyUploaded
                        ? c.primarySoft
                        : showRejectedBadge
                          ? "#fdf0ef"
                          : c.surface,
                      borderColor: isNewlyUploaded
                        ? c.primary
                        : showRejectedBadge
                          ? "#c0392b"
                          : c.border,
                      opacity: pressed || submitting ? 0.85 : 1,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.docIcon,
                      {
                        backgroundColor: isNewlyUploaded
                          ? c.primary
                          : showRejectedBadge
                            ? "#c0392b"
                            : c.background,
                      },
                    ]}
                  >
                    {isUploading ? (
                      <ActivityIndicator size="small" color={isNewlyUploaded ? "#fff" : c.primary} />
                    ) : (
                      <Feather
                        name={isNewlyUploaded ? "check" : showRejectedBadge ? "x" : d.icon}
                        size={18}
                        color={isNewlyUploaded || showRejectedBadge ? "#fff" : c.primary}
                      />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.docLabel, { color: c.foreground, fontFamily: fonts.semiBold }]}>{docLabel}</Text>
                    <Text
                      style={[
                        styles.docHint,
                        {
                          color: isNewlyUploaded
                            ? c.mutedForeground
                            : showRejectedBadge
                              ? "#c0392b"
                              : c.mutedForeground,
                          fontFamily: fonts.medium,
                        },
                      ]}
                    >
                      {isUploading
                        ? t("becomeDriver.uploading")
                        : isNewlyUploaded
                          ? t("becomeDriver.uploadedReplace")
                          : showRejectedBadge
                            ? t("reuploadDocs.rejectedHint")
                            : t("becomeDriver.tapToUpload")}
                    </Text>
                  </View>
                  {showRejectedBadge ? (
                    <View style={[styles.statusBadge, { backgroundColor: "#fde8e6", borderColor: "#c0392b" }]}>
                      <Text style={[styles.statusBadgeText, { color: "#c0392b", fontFamily: fonts.semiBold }]}>
                        {t("reuploadDocs.rejected")}
                      </Text>
                    </View>
                  ) : (
                    <Feather
                      name="upload"
                      size={16}
                      color={isNewlyUploaded ? c.primary : c.mutedForeground}
                    />
                  )}
                </Pressable>

                {showRejectedBadge && !!rejectionReason && (
                  <View style={[styles.rejectionBanner, { backgroundColor: "#fdf0ef", borderColor: "#e8b4b0" }]}>
                    <Feather name="info" size={13} color="#c0392b" />
                    <Text style={[styles.rejectionText, { fontFamily: fonts.medium, textAlign: fonts.isRTL ? "right" : "left", lineHeight: fonts.getBodyLineHeight(12) }]}>
                      <Text style={{ fontFamily: fonts.semiBold }}>{t("reuploadDocs.reason")}</Text>
                      {rejectionReason}
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button
          label={submitting ? t("reuploadDocs.submitting") : t("reuploadDocs.resubmit")}
          disabled={!allRequiredUploaded || submitting || uploadingKey !== null}
          onPress={handleResubmit}
        />
      </View>
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
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 24,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 1.2,
    marginBottom: 12,
  },
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
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 11,
  },
  rejectionBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    marginTop: 6,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  rejectionText: {
    flex: 1,
    fontSize: 12,
    color: "#7b1a11",
    lineHeight: 17,
  },
  footer: { paddingHorizontal: 24, paddingTop: 12 },
});
