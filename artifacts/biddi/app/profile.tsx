import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import React from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import {
  type DriverSavedPlace,
  getListDriverSavedPlacesQueryKey,
  useDeleteDriverSavedPlace,
  useListDriverSavedPlaces,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

import { Avatar } from "@/components/Avatar";
import { useAuth } from "@/context/AppContext";
import { useLanguage } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { api, getBaseUrl, getTokenSync, loadToken } from "@/lib/api";
import { type AppLanguage, LANGUAGES } from "@/i18n";
import { checkNavApps } from "@/lib/maps";
import { getJSON, remove as removeJSON, setJSON } from "@/lib/storage";
import {
  disableBiometricLogin,
  enableBiometricLogin,
  getBiometricCapability,
  isBiometricLoginEnabled,
  promptBiometric,
} from "@/lib/biometric";

type NavApp = "google" | "apple" | "waze";

function docLabel(type: string): string {
  const map: Record<string, string> = {
    license: "License",
    insurance: "Insurance",
    registration: "Registration",
    selfie: "Selfie",
  };
  return map[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

function resolveUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const base = getBaseUrl().replace(/\/api$/, "");
  return `${base}${url}`;
}

export default function ProfileScreen() {
  const c = useColors();
  const { isRTL, ...fonts } = useFontFamily();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, submittedDocs, acceptanceRate, cancellationRate, logout, switchAppMode, refreshUser } = useAuth();
  const { language, setLanguage } = useLanguage();
  const { t } = useTranslation();

  const [localMode, setLocalMode] = React.useState<"driver" | "rider" | null>(null);
  const [switching, setSwitching] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [imgErrors, setImgErrors] = React.useState<Record<string, boolean>>({});
  const [showStatusSheet, setShowStatusSheet] = React.useState(false);
  const [uploadingPhoto, setUploadingPhoto] = React.useState(false);
  const [navApps, setNavApps] = React.useState<{ google: boolean; apple: boolean; waze: boolean } | null>(null);
  const [navPreference, setNavPreference] = React.useState<NavApp | null>(null);
  const [showNavModal, setShowNavModal] = React.useState(false);
  const [bioCap, setBioCap] = React.useState<{
    available: boolean;
    enrolled: boolean;
    label: "face" | "fingerprint" | "iris" | "biometric";
  } | null>(null);
  const [bioEnabled, setBioEnabled] = React.useState(false);
  const [bioBusy, setBioBusy] = React.useState(false);

  const qc = useQueryClient();
  const isApprovedDriver = user?.driverStatus === "approved";
  const savedPlacesQ = useListDriverSavedPlaces({
    query: {
      queryKey: getListDriverSavedPlacesQueryKey(),
      enabled: !!isApprovedDriver,
    },
  });
  const deletePlaceM = useDeleteDriverSavedPlace();
  const refreshSavedPlaces = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: getListDriverSavedPlacesQueryKey() });
  }, [qc]);
  const handleDeleteSavedPlace = React.useCallback(
    (place: DriverSavedPlace, kind: "home" | "work") => {
      const title =
        kind === "home"
          ? t("profile.savedPlaceRemoveHomeTitle", { defaultValue: "Remove Home?" })
          : t("profile.savedPlaceRemoveWorkTitle", { defaultValue: "Remove Work?" });
      Alert.alert(
        title,
        place.address,
        [
          { text: t("common.cancel", { defaultValue: "Cancel" }), style: "cancel" },
          {
            text: t("common.remove", { defaultValue: "Remove" }),
            style: "destructive",
            onPress: () => {
              deletePlaceM.mutate({ id: place.id }, { onSuccess: refreshSavedPlaces });
            },
          },
        ],
      );
    },
    [deletePlaceM, refreshSavedPlaces, t],
  );

  React.useEffect(() => {
    getBiometricCapability().then(setBioCap).catch(() => {});
    isBiometricLoginEnabled().then(setBioEnabled).catch(() => {});
  }, []);

  const bioRowLabel =
    bioCap?.label === "face"
      ? t("profile.signInWithFaceId")
      : bioCap?.label === "fingerprint"
        ? t("profile.signInWithFingerprint")
        : t("profile.signInWithBiometric");

  const handleBioToggle = async (next: boolean) => {
    if (bioBusy) return;
    setBioBusy(true);
    try {
      if (next) {
        if (!bioCap?.available || !bioCap.enrolled) {
          Alert.alert(t("profile.bioUnavailableTitle"), t("profile.bioUnavailableBody"));
          return;
        }
        const ok = await promptBiometric(t("profile.bioConfirmPrompt"));
        if (!ok) return;
        const token = getTokenSync() ?? (await loadToken());
        if (!token) {
          Alert.alert(t("profile.bioUnavailableTitle"), t("profile.bioNoSession"));
          return;
        }
        await enableBiometricLogin(token, bioCap.label);
        setBioEnabled(true);
      } else {
        await disableBiometricLogin();
        setBioEnabled(false);
      }
    } catch {
      Alert.alert(t("profile.bioUnavailableTitle"), t("profile.bioUnavailableBody"));
    } finally {
      setBioBusy(false);
    }
  };

  React.useEffect(() => {
    checkNavApps().then(setNavApps).catch(() => {});
    getJSON<NavApp>("nav_preference")
      .then((v) => {
        if (v === "google" || v === "apple" || v === "waze") setNavPreference(v);
        else setNavPreference(null);
      })
      .catch(() => {});
  }, []);

  const navAppLabel = React.useCallback(
    (app: NavApp): string => {
      if (app === "google") return t("driverTrip.navGoogleMaps");
      if (app === "apple") return t("driverTrip.navAppleMaps");
      return t("driverTrip.navWaze");
    },
    [t],
  );

  const saveNavPreference = React.useCallback((app: NavApp) => {
    setNavPreference(app);
    setJSON("nav_preference", app).catch(() => {});
  }, []);

  const clearNavPreference = React.useCallback(() => {
    setNavPreference(null);
    removeJSON("nav_preference").catch(() => {});
  }, []);

  const openNavPicker = React.useCallback(() => {
    if (!navApps) return;
    if (Platform.OS === "ios") {
      const labels: string[] = [];
      const actions: (NavApp | "clear")[] = [];
      if (navApps.google) {
        labels.push(navAppLabel("google"));
        actions.push("google");
      }
      if (navApps.apple) {
        labels.push(navAppLabel("apple"));
        actions.push("apple");
      }
      if (navApps.waze) {
        labels.push(navAppLabel("waze"));
        actions.push("waze");
      }
      labels.push(t("profile.navAskEachTime"));
      actions.push("clear");
      labels.push(t("common.cancel"));
      const cancelButtonIndex = labels.length - 1;
      ActionSheetIOS.showActionSheetWithOptions(
        { options: labels, cancelButtonIndex, title: t("profile.defaultNavApp") },
        (idx) => {
          const choice = actions[idx];
          if (!choice) return;
          if (choice === "clear") clearNavPreference();
          else saveNavPreference(choice);
        },
      );
    } else {
      setShowNavModal(true);
    }
  }, [navApps, navAppLabel, saveNavPreference, clearNavPreference, t]);

  React.useEffect(() => {
    setImgErrors({});
  }, [submittedDocs]);

  React.useEffect(() => {
    if (!user) {
      router.replace("/login");
    }
  }, [user]);

  React.useEffect(() => {
    setLocalMode(null);
  }, [user?.appMode]);

  if (!user) return null;

  const isApproved = user.driverStatus === "approved";
  const inDriverMode = (localMode ?? user.appMode) === "driver";

  const docsWithUrl = submittedDocs.filter((d) => !!d.url);

  const handleSwitch = async (next: boolean) => {
    if (next && !isApproved) return;
    if (switching) return;
    setLocalMode(next ? "driver" : "rider");
    setSwitching(true);
    try {
      await switchAppMode(next ? "driver" : "rider");
      router.replace(next ? "/(driver)/home" : "/(rider)/home");
    } catch {
      setLocalMode(user.appMode);
    } finally {
      setSwitching(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  const handlePhotoPress = () => {
    Alert.alert(
      "Profile Photo",
      "Choose a photo for your profile",
      [
        {
          text: "Camera",
          onPress: () => pickImage("camera"),
        },
        {
          text: "Photo Library",
          onPress: () => pickImage("library"),
        },
        { text: "Cancel", style: "cancel" },
      ],
    );
  };

  const pickImage = async (source: "camera" | "library") => {
    try {
      let result: ImagePicker.ImagePickerResult;
      if (source === "camera") {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission required", "Camera permission is needed to take a photo.");
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: "images",
          quality: 0.8,
          allowsEditing: false,
        });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission required", "Photo library permission is needed to select a photo.");
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: "images",
          quality: 0.8,
          allowsEditing: false,
        });
      }

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      await uploadProfilePhoto(asset);
    } catch {
      Alert.alert("Error", "Could not open photo picker. Please try again.");
    }
  };

  const uploadProfilePhoto = async (asset: ImagePicker.ImagePickerAsset) => {
    setUploadingPhoto(true);
    try {
      const uri = asset.uri;
      const fileName = uri.split("/").pop() ?? "photo.jpg";
      const mimeType = asset.mimeType ?? "image/jpeg";

      const blobRes = await fetch(uri);
      const blob = await blobRes.blob();

      const { uploadURL, objectPath } = await api<{ uploadURL: string; objectPath: string }>(
        "/storage/uploads/profile-request-url",
        {
          method: "POST",
          json: { name: fileName, size: blob.size, contentType: mimeType },
        },
      );

      const putRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: blob,
      });
      if (!putRes.ok) {
        throw new Error(`Upload failed with status ${putRes.status}`);
      }

      await api("/storage/uploads/profile-finalize", {
        method: "POST",
        json: { objectPath },
      });

      await refreshUser();
    } catch {
      Alert.alert("Upload failed", "Could not upload profile photo. Please try again.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const driverModeSubtitle = isApproved
    ? inDriverMode
      ? t("profile.driverOnline")
      : t("profile.driverOffline")
    : user.driverStatus === "pending"
    ? t("profile.applicationReview")
    : user.driverStatus === "rejected"
    ? t("profile.applicationRejected")
    : t("profile.becomeDriverHint");

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="x" size={22} color={c.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.foreground, fontFamily: fonts.semiBold }]}>{t("profile.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <View style={styles.userCard}>
          <Pressable
            onPress={handlePhotoPress}
            style={({ pressed }) => [styles.avatarWrap, { opacity: pressed ? 0.8 : 1 }]}
          >
            <Avatar
              initial={user.firstName.charAt(0) || "?"}
              size={68}
              photoUrl={user.photoUrl}
            />
            {uploadingPhoto ? (
              <View style={styles.avatarOverlay}>
                <ActivityIndicator color="#fff" size="small" />
              </View>
            ) : (
              <View style={styles.avatarOverlay}>
                <Feather name="camera" size={16} color="#fff" />
              </View>
            )}
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.userName, { color: c.foreground, fontFamily: fonts.bold }]}>
              {user.firstName} {user.lastName}
            </Text>
            <Text style={[styles.userPhone, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
              {user.countryCode} {user.phone.replace(user.countryCode, "")}
            </Text>
          </View>
        </View>

        <View style={[styles.modeCard, { backgroundColor: c.primarySoft }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.modeTitle, { color: c.primary, fontFamily: fonts.semiBold }]}>{t("profile.driverMode")}</Text>
            <Text style={[styles.modeSub, { color: c.foreground, fontFamily: fonts.medium }]}>
              {driverModeSubtitle}
            </Text>
          </View>
          <Switch
            value={inDriverMode}
            onValueChange={handleSwitch}
            disabled={!isApproved || switching}
            trackColor={{ true: c.primary, false: c.border }}
            thumbColor="#fff"
          />
        </View>

        {!isApproved && user.driverStatus === "rejected" && (
          <Pressable
            onPress={() => router.push("/reupload-docs")}
            style={({ pressed }) => [
              styles.becomeBtn,
              { backgroundColor: "#c0392b", opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <Feather name="upload" size={18} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.becomeTitle, { fontFamily: fonts.bold }]}>Re-upload documents</Text>
              <Text style={[styles.becomeSub, { fontFamily: fonts.medium }]}>Resubmit to get approved</Text>
            </View>
            <Feather name={isRTL ? "arrow-left" : "arrow-right"} size={20} color="#fff" />
          </Pressable>
        )}

        {!isApproved && user.driverStatus === "not_applied" && (
          <Pressable
            onPress={() => router.push("/become-driver")}
            style={({ pressed }) => [
              styles.becomeBtn,
              { backgroundColor: c.foreground, opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <Feather name="truck" size={18} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.becomeTitle, { fontFamily: fonts.bold }]}>{t("profile.becomeBiddiDriver")}</Text>
              <Text style={[styles.becomeSub, { fontFamily: fonts.medium }]}>{t("profile.earnSchedule")}</Text>
            </View>
            <Feather name={isRTL ? "arrow-left" : "arrow-right"} size={20} color="#fff" />
          </Pressable>
        )}

        {user.driverStatus === "pending" && (
          <Pressable
            onPress={() => setShowStatusSheet(true)}
            style={({ pressed }) => [
              styles.pendingBox,
              { backgroundColor: c.accentSoft, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Feather name="clock" size={18} color={c.accent} />
            <Text style={[styles.pendingText, { color: c.foreground, fontFamily: fonts.medium, lineHeight: fonts.getBodyLineHeight(13) }]}>
              {t("profile.applicationPending")}
            </Text>
            <Feather name={isRTL ? "chevron-left" : "chevron-right"} size={16} color={c.accent} />
          </Pressable>
        )}

        {(isApproved || user.driverStatus === "suspended") && (
          <View style={[styles.section, { marginTop: 0 }]}>
            <Text style={[styles.sectionLabel, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>
              {t("profile.driverStats")}
            </Text>
            <View style={styles.statsRow}>
              <View style={[styles.statTile, { backgroundColor: c.surface }]}>
                <Text style={[styles.statLabel, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                  {t("profile.acceptanceRate")}
                </Text>
                <Text style={[styles.statValue, { color: c.foreground, fontFamily: fonts.bold }]}>
                  {acceptanceRate == null ? "—" : `${acceptanceRate.toFixed(1)}%`}
                </Text>
                {acceptanceRate == null && (
                  <Text style={[styles.statHint, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                    {t("profile.statsNotEnoughData")}
                  </Text>
                )}
              </View>
              <View style={[styles.statTile, { backgroundColor: c.surface }]}>
                <Text style={[styles.statLabel, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                  {t("profile.cancellationRate")}
                </Text>
                <Text style={[styles.statValue, { color: c.foreground, fontFamily: fonts.bold }]}>
                  {cancellationRate == null ? "—" : `${cancellationRate.toFixed(1)}%`}
                </Text>
                {cancellationRate == null && (
                  <Text style={[styles.statHint, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                    {t("profile.statsNotEnoughData")}
                  </Text>
                )}
              </View>
            </View>
            {(user.driverRating != null || (user.driverRatingCount ?? 0) > 0) && (
              <View style={[styles.ratingRow, { backgroundColor: c.surface }]}>
                <Text style={[styles.ratingLabel, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                  {t("profile.driverRating", { defaultValue: "Driver Rating" })}
                </Text>
                <Text style={[styles.ratingValue, { color: c.foreground, fontFamily: fonts.bold }]}>
                  {`${(user.driverRating ?? 0).toFixed(1)} ★ · ${t("profile.basedOnRatings", { count: user.driverRatingCount ?? 0, defaultValue: "Based on {{count}} ratings" })}`}
                </Text>
              </View>
            )}
          </View>
        )}

        {(user.customerRatingCount ?? 0) > 0 && (
          <View style={[styles.section, { marginTop: 0 }]}>
            <Text style={[styles.sectionLabel, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>
              {t("profile.customerRating", { defaultValue: "RIDER RATING" })}
            </Text>
            <View style={[styles.ratingRow, { backgroundColor: c.surface }]}>
              <Text style={[styles.ratingLabel, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                {t("profile.asARider", { defaultValue: "As a Rider" })}
              </Text>
              <Text style={[styles.ratingValue, { color: c.foreground, fontFamily: fonts.bold }]}>
                {`${(user.customerRating ?? 0).toFixed(1)} ★ · ${t("profile.basedOnRatings", { count: user.customerRatingCount ?? 0, defaultValue: "Based on {{count}} ratings" })}`}
              </Text>
            </View>
          </View>
        )}

        {docsWithUrl.length > 0 && (
          <View style={[styles.docsSection, { paddingHorizontal: 20, marginTop: 4, marginBottom: 4 }]}>
            <Text style={[styles.sectionLabel, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>SUBMITTED DOCUMENTS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.docsList}>
              {docsWithUrl.map((doc) => {
                const fullUrl = resolveUrl(doc.url);
                const hasError = imgErrors[fullUrl];
                return (
                  <Pressable
                    key={`${doc.type}::${fullUrl}`}
                    onPress={() => !hasError && setPreviewUrl(fullUrl)}
                    style={({ pressed }) => [
                      styles.docThumbWrap,
                      { backgroundColor: c.surface, opacity: pressed ? 0.85 : 1 },
                    ]}
                  >
                    {hasError ? (
                      <View style={[styles.docThumb, styles.docThumbFallback, { backgroundColor: c.border }]}>
                        <Feather name="file-text" size={28} color={c.mutedForeground} />
                      </View>
                    ) : (
                      <Image
                        source={{ uri: fullUrl }}
                        style={styles.docThumb}
                        resizeMode="cover"
                        onError={() =>
                          setImgErrors((prev) => ({ ...prev, [fullUrl]: true }))
                        }
                      />
                    )}
                    <Text style={[styles.docThumbLabel, { color: c.foreground, fontFamily: fonts.medium }]} numberOfLines={1}>
                      {docLabel(doc.type)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        <Section label={t("profile.account")}>
          <Row icon="user" label={t("profile.personalInfo")} onPress={() => router.push("/personal-info")} />
          <Row icon="users" label="Referrals" onPress={() => router.push("/referrals" as never)} />
          <Row icon="credit-card" label={t("profile.payment")} />
          <Row icon="bell" label={t("profile.notifications")} />
          <Row
            icon="message-square"
            label={t("profile.quickReplies", { defaultValue: "Quick Replies" })}
            onPress={() => router.push("/quick-replies" as never)}
          />
          <Row icon="shield" label={t("profile.privacy")} />
        </Section>

        {bioCap?.available && (
          <Section label={t("profile.security")}>
            <View
              style={[styles.row, { borderBottomColor: c.border }]}
            >
              <Feather
                name={bioCap.label === "face" ? "smile" : "shield"}
                size={18}
                color={c.mutedForeground}
              />
              <Text style={[styles.rowLabel, { color: c.foreground, fontFamily: fonts.medium }]}>
                {bioRowLabel}
              </Text>
              <Switch
                value={bioEnabled}
                onValueChange={handleBioToggle}
                disabled={bioBusy || !bioCap.enrolled}
                trackColor={{ true: c.primary, false: c.border }}
                thumbColor="#fff"
              />
            </View>
          </Section>
        )}

        {isApproved && (
          <Section label={t("profile.driverSettings")}>
            <Row
              icon="navigation"
              label={t("profile.defaultNavApp")}
              value={navPreference ? navAppLabel(navPreference) : t("profile.navAskEachTime")}
              onPress={openNavPicker}
            />
          </Section>
        )}

        {isApproved && (
          <Section
            label={t("profile.savedPlaces", { defaultValue: "SAVED PLACES" })}
          >
            <SavedPlaceRow
              icon="home"
              label={t("profile.savedPlaceHome", { defaultValue: "Home" })}
              place={savedPlacesQ.data?.home ?? null}
              emptyHint={t("profile.savedPlaceEmpty", {
                defaultValue: "Not set · tap to add",
              })}
              onPress={() => router.push("/(driver)/destination")}
              onDelete={(p) => handleDeleteSavedPlace(p, "home")}
              busy={deletePlaceM.isPending}
            />
            <SavedPlaceRow
              icon="briefcase"
              label={t("profile.savedPlaceWork", { defaultValue: "Work" })}
              place={savedPlacesQ.data?.work ?? null}
              emptyHint={t("profile.savedPlaceEmpty", {
                defaultValue: "Not set · tap to add",
              })}
              onPress={() => router.push("/(driver)/destination")}
              onDelete={(p) => handleDeleteSavedPlace(p, "work")}
              busy={deletePlaceM.isPending}
              isLast
            />
          </Section>
        )}

        <Section label={t("language.label")}>
          {LANGUAGES.map((lang) => (
            <LanguageRow
              key={lang.code}
              lang={lang}
              selected={language === lang.code}
              onSelect={() => setLanguage(lang.code as AppLanguage)}
            />
          ))}
        </Section>

        <Section label={t("profile.support")}>
          <Row icon="help-circle" label={t("profile.helpCenter")} />
          <Row icon="file-text" label={t("profile.terms")} />
        </Section>

        <Pressable
          onPress={handleLogout}
          style={({ pressed }) => [styles.logoutBtn, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Feather name="log-out" size={18} color={c.destructive} />
          <Text style={[styles.logoutText, { color: c.destructive, fontFamily: fonts.semiBold }]}>{t("profile.logout")}</Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={previewUrl !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewUrl(null)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalClose} onPress={() => setPreviewUrl(null)}>
            <Feather name="x" size={24} color="#fff" />
          </Pressable>
          {previewUrl && (
            <Image
              source={{ uri: previewUrl }}
              style={styles.modalImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      <Modal
        visible={showNavModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowNavModal(false)}
      >
        <View style={styles.navModalOverlay}>
          <View style={[styles.navModalSheet, { backgroundColor: c.background, paddingBottom: insets.bottom + 16 }]}>
            <View style={[styles.navModalHandle, { backgroundColor: c.border }]} />
            <Text style={[styles.navModalTitle, { color: c.foreground, fontFamily: fonts.bold }]}>
              {t("profile.defaultNavApp")}
            </Text>
            {navApps?.google && (
              <NavOption
                label={navAppLabel("google")}
                icon="map"
                selected={navPreference === "google"}
                onPress={() => {
                  setShowNavModal(false);
                  saveNavPreference("google");
                }}
              />
            )}
            {navApps?.apple && (
              <NavOption
                label={navAppLabel("apple")}
                icon="map"
                selected={navPreference === "apple"}
                onPress={() => {
                  setShowNavModal(false);
                  saveNavPreference("apple");
                }}
              />
            )}
            {navApps?.waze && (
              <NavOption
                label={navAppLabel("waze")}
                icon="navigation"
                selected={navPreference === "waze"}
                onPress={() => {
                  setShowNavModal(false);
                  saveNavPreference("waze");
                }}
              />
            )}
            <NavOption
              label={t("profile.navAskEachTime")}
              icon="help-circle"
              selected={navPreference === null}
              onPress={() => {
                setShowNavModal(false);
                clearNavPreference();
              }}
            />
            <Pressable
              onPress={() => setShowNavModal(false)}
              style={({ pressed }) => [styles.navModalCancel, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.navModalCancelText, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>
                {t("common.cancel")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showStatusSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowStatusSheet(false)}
      >
        <Pressable style={styles.sheetOverlay} onPress={() => setShowStatusSheet(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: c.background, paddingBottom: insets.bottom + 16 }]}
            onPress={() => {}}
          >
            <View style={[styles.sheetHandle, { backgroundColor: c.border }]} />
            <Text style={[styles.sheetTitle, { color: c.foreground, fontFamily: fonts.bold }]}>
              {t("profile.appStatusTitle")}
            </Text>
            <Text style={[styles.sheetTurnaround, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
              {t("profile.appStatusTurnaround")}
            </Text>

            {submittedDocs.length > 0 && (
              <View style={{ marginTop: 20 }}>
                <Text style={[styles.sheetSectionLabel, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>
                  {t("profile.appStatusDocs")}
                </Text>
                <View style={[styles.sheetDocsList, { backgroundColor: c.surface }]}>
                  {submittedDocs.map((doc, idx) => {
                    const docStatus = doc.status;
                    const isAccepted = docStatus === "approved";
                    const isRejected = docStatus === "rejected";
                    const statusLabel = isAccepted
                      ? t("profile.appStatusDocAccepted")
                      : isRejected
                      ? t("profile.appStatusDocRejected")
                      : t("profile.appStatusDocPending");
                    const statusColor = isAccepted
                      ? "#22c55e"
                      : isRejected
                      ? c.destructive
                      : c.accent;
                    const statusIcon: React.ComponentProps<typeof Feather>["name"] = isAccepted
                      ? "check-circle"
                      : isRejected
                      ? "x-circle"
                      : "clock";
                    return (
                      <View
                        key={doc.type}
                        style={[
                          styles.sheetDocRow,
                          { borderBottomColor: c.border },
                          idx === submittedDocs.length - 1 && { borderBottomWidth: 0 },
                        ]}
                      >
                        <Feather name={statusIcon} size={18} color={statusColor} />
                        <Text style={[styles.sheetDocLabel, { color: c.foreground, fontFamily: fonts.medium }]}>
                          {docLabel(doc.type)}
                        </Text>
                        <Text style={[styles.sheetDocStatus, { color: statusColor, fontFamily: fonts.semiBold }]}>
                          {statusLabel}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            <Pressable
              onPress={() => setShowStatusSheet(false)}
              style={({ pressed }) => [styles.sheetCloseBtn, { backgroundColor: c.surface, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.sheetCloseBtnText, { color: c.foreground, fontFamily: fonts.semiBold }]}>
                {t("profile.appStatusClose")}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const c = useColors();
  const fonts = useFontFamily();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>{label}</Text>
      <View style={[styles.sectionBody, { backgroundColor: c.surface }]}>{children}</View>
    </View>
  );
}

function Row({
  icon,
  label,
  value,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  value?: string;
  onPress?: () => void;
}) {
  const c = useColors();
  const { isRTL, ...fonts } = useFontFamily();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: c.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Feather name={icon} size={18} color={c.mutedForeground} />
      <Text style={[styles.rowLabel, { color: c.foreground, fontFamily: fonts.medium }]}>{label}</Text>
      <View style={styles.rowTrailing}>
        {value && (
          <Text
            style={[styles.rowValue, { color: c.mutedForeground, fontFamily: fonts.medium }]}
            numberOfLines={1}
          >
            {value}
          </Text>
        )}
        <Feather name={isRTL ? "chevron-left" : "chevron-right"} size={18} color={c.mutedForeground} />
      </View>
    </Pressable>
  );
}

function SavedPlaceRow({
  icon,
  label,
  place,
  emptyHint,
  onPress,
  onDelete,
  busy,
  isLast,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  place: DriverSavedPlace | null;
  emptyHint: string;
  onPress: () => void;
  onDelete: (place: DriverSavedPlace) => void;
  busy?: boolean;
  isLast?: boolean;
}) {
  const c = useColors();
  const { isRTL, ...fonts } = useFontFamily();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          borderBottomColor: c.border,
          borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Feather name={icon} size={18} color={c.mutedForeground} />
      <View style={{ flex: 1 }}>
        <Text
          style={[styles.rowLabel, { color: c.foreground, fontFamily: fonts.medium }]}
          numberOfLines={1}
        >
          {label}
        </Text>
        <Text
          style={[
            styles.rowValue,
            {
              color: c.mutedForeground,
              fontFamily: fonts.medium,
              marginTop: 2,
            },
          ]}
          numberOfLines={1}
        >
          {place ? place.address : emptyHint}
        </Text>
      </View>
      {place ? (
        <Pressable
          onPress={() => onDelete(place)}
          hitSlop={10}
          disabled={busy}
          style={{ paddingHorizontal: 6 }}
        >
          <Feather name="trash-2" size={18} color={c.mutedForeground} />
        </Pressable>
      ) : (
        <Feather
          name={isRTL ? "chevron-left" : "chevron-right"}
          size={18}
          color={c.mutedForeground}
        />
      )}
    </Pressable>
  );
}

function NavOption({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  selected: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  const fonts = useFontFamily();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.navOptionBtn,
        { backgroundColor: c.surface, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Feather name={icon} size={20} color={c.primary} />
      <Text style={[styles.navOptionText, { color: c.foreground, fontFamily: fonts.semiBold }]}>
        {label}
      </Text>
      {selected && <Feather name="check" size={18} color={c.primary} />}
    </Pressable>
  );
}

function LanguageRow({
  lang,
  selected,
  onSelect,
}: {
  lang: { code: string; nativeLabel: string };
  selected: boolean;
  onSelect: () => void;
}) {
  const c = useColors();
  const fonts = useFontFamily();
  return (
    <Pressable
      onPress={onSelect}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: c.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Feather name="globe" size={18} color={c.mutedForeground} />
      <Text style={[styles.rowLabel, { color: c.foreground, fontFamily: fonts.medium }]}>{lang.nativeLabel}</Text>
      {selected && (
        <Feather name="check" size={18} color={c.primary} style={{ marginStart: "auto" }} />
      )}
    </Pressable>
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
  userCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginBottom: 16,
  },
  avatarWrap: {
    position: "relative",
  },
  avatarOverlay: {
    position: "absolute",
    bottom: 0,
    end: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  userName: { fontSize: 22 },
  userPhone: { fontSize: 14, marginTop: 4 },
  modeCard: {
    marginHorizontal: 20,
    borderRadius: 18,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  modeTitle: { fontSize: 12, letterSpacing: 1 },
  modeSub: { fontSize: 14, marginTop: 2 },
  becomeBtn: {
    marginHorizontal: 20,
    borderRadius: 18,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 14,
  },
  becomeTitle: { color: "#fff", fontSize: 15 },
  becomeSub: { color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 2 },
  pendingBox: {
    marginHorizontal: 20,
    borderRadius: 18,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  pendingText: { flex: 1, fontSize: 13, lineHeight: 18 },
  docsSection: {},
  docsList: {
    paddingVertical: 8,
    gap: 12,
  },
  docThumbWrap: {
    borderRadius: 14,
    overflow: "hidden",
    width: 90,
    alignItems: "center",
    paddingBottom: 8,
  },
  docThumb: {
    width: 90,
    height: 90,
    borderRadius: 14,
    marginBottom: 6,
  },
  docThumbFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  docThumbLabel: {
    fontSize: 11,
    textAlign: "center",
    paddingHorizontal: 4,
  },
  section: { paddingHorizontal: 20, marginTop: 18 },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 1.2,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionBody: { borderRadius: 18, overflow: "hidden" },
  statsRow: {
    flexDirection: "row",
    gap: 12,
  },
  statTile: {
    flex: 1,
    borderRadius: 14,
    padding: 14,
  },
  statLabel: {
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  statValue: {
    fontSize: 22,
    marginTop: 4,
  },
  statHint: {
    fontSize: 11,
    marginTop: 2,
  },
  ratingRow: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 10,
    gap: 4,
  },
  ratingLabel: {
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  ratingValue: {
    fontSize: 16,
    marginTop: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { fontSize: 15, flex: 1 },
  rowTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginStart: "auto",
    flexShrink: 1,
  },
  rowValue: {
    fontSize: 14,
    flexShrink: 1,
  },
  navModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  navModalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  navModalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  navModalTitle: {
    fontSize: 18,
    textAlign: "center",
    marginBottom: 16,
  },
  navOptionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 14,
    marginBottom: 10,
  },
  navOptionText: {
    flex: 1,
    fontSize: 15,
  },
  navModalCancel: {
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  navModalCancelText: {
    fontSize: 15,
  },
  logoutBtn: {
    marginTop: 24,
    marginHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
  },
  logoutText: { fontSize: 15 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalClose: {
    position: "absolute",
    top: 52,
    end: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  modalImage: {
    width: "92%",
    height: "75%",
    borderRadius: 12,
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 20,
  },
  sheetTitle: {
    fontSize: 20,
    marginBottom: 8,
  },
  sheetTurnaround: {
    fontSize: 14,
    lineHeight: 20,
  },
  sheetSectionLabel: {
    fontSize: 11,
    letterSpacing: 1.2,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sheetDocsList: {
    borderRadius: 18,
    overflow: "hidden",
  },
  sheetDocRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetDocLabel: {
    flex: 1,
    fontSize: 15,
  },
  sheetDocStatus: {
    fontSize: 13,
  },
  sheetCloseBtn: {
    marginTop: 20,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
  },
  sheetCloseBtnText: {
    fontSize: 15,
  },
});
