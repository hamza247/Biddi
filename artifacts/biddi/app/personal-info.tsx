import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
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
import { useAuth, useVehicle } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";

export default function PersonalInfoScreen() {
  const c = useColors();
  const fonts = useFontFamily();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, updateProfile } = useAuth();
  const { vehicle, updateVehicle } = useVehicle();
  const { t } = useTranslation();

  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [make, setMake] = useState(vehicle?.make ?? "");
  const [model, setModel] = useState(vehicle?.model ?? "");
  const [year, setYear] = useState(vehicle?.year ?? "");
  const [color, setColor] = useState(vehicle?.color ?? "");
  const [plate, setPlate] = useState(vehicle?.plate ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) router.replace("/login");
  }, [user, router]);

  if (!user) return null;

  const showVehicle = user.driverStatus !== "not_applied";
  const canEditVehicle = user.driverStatus === "pending" || user.driverStatus === "rejected";

  const handleSave = async () => {
    if (!firstName.trim()) {
      setFieldError(t("personalInfo.firstNameRequired"));
      return;
    }
    setFieldError(null);
    setGeneralError(null);
    setSaving(true);
    const isNetworkError = (e: unknown) =>
      e instanceof TypeError || (e instanceof Error && e.message === "Failed to fetch");
    const attemptSave = async () => {
      await updateProfile(firstName.trim(), lastName.trim());
      if (canEditVehicle && make && model && year && color && plate) {
        await updateVehicle({ make, model, year, color, plate });
      }
    };
    try {
      await attemptSave();
      setSaved(true);
      setTimeout(() => router.back(), 600);
    } catch (e: unknown) {
      if (isNetworkError(e)) {
        try {
          await new Promise((r) => setTimeout(r, 800));
          await attemptSave();
          setSaved(true);
          setTimeout(() => router.back(), 600);
          return;
        } catch {
          setGeneralError(t("personalInfo.connectionFailed"));
        }
      } else {
        setGeneralError(t("personalInfo.couldNotSave"));
      }
    } finally {
      setSaving(false);
    }
  };

  const saveLabel = saved
    ? t("personalInfo.saved")
    : saving
    ? t("personalInfo.saving")
    : t("personalInfo.saveChanges");

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior="padding"
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="x" size={22} color={c.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.foreground, fontFamily: fonts.semiBold }]}>{t("personalInfo.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.section, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>{t("personalInfo.yourDetails")}</Text>
        <Field
          label={t("personalInfo.firstName")}
          value={firstName}
          onChangeText={(v) => { setFirstName(v); setFieldError(null); }}
          error={fieldError ?? undefined}
        />
        <Field label={t("personalInfo.lastName")} value={lastName} onChangeText={setLastName} />

        <View style={[styles.staticRow, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.staticLabel, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>{t("personalInfo.phone")}</Text>
          <Text style={[styles.staticValue, { color: c.foreground, fontFamily: fonts.medium }]}>{user.phone}</Text>
          <Text style={[styles.staticHint, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
            {t("personalInfo.phoneChangeHint")}
          </Text>
        </View>

        {showVehicle && (
          <>
            <Text style={[styles.section, { color: c.mutedForeground, marginTop: 24, fontFamily: fonts.semiBold }]}>
              {t("personalInfo.vehicle")}
            </Text>
            {!canEditVehicle && (
              <Text style={[styles.lockedHint, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                {t("personalInfo.vehicleLocked")}
              </Text>
            )}
            <View style={styles.formRow}>
              <Field
                label={t("personalInfo.make")}
                value={make}
                onChangeText={setMake}
                editable={canEditVehicle}
              />
              <Field
                label={t("personalInfo.model")}
                value={model}
                onChangeText={setModel}
                editable={canEditVehicle}
              />
            </View>
            <View style={styles.formRow}>
              <Field
                label={t("personalInfo.year")}
                value={year}
                onChangeText={setYear}
                editable={canEditVehicle}
                keyboardType="number-pad"
              />
              <Field
                label={t("personalInfo.color")}
                value={color}
                onChangeText={setColor}
                editable={canEditVehicle}
              />
            </View>
            <Field
              label={t("personalInfo.plate")}
              value={plate}
              onChangeText={(v) => setPlate(v.toUpperCase())}
              editable={canEditVehicle}
            />
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        {generalError && (
          <Text style={[styles.generalError, { fontFamily: fonts.medium }]}>{generalError}</Text>
        )}
        <Button
          label={saveLabel}
          disabled={saving || saved}
          onPress={handleSave}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  editable = true,
  error,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "number-pad";
  editable?: boolean;
  error?: string;
}) {
  const c = useColors();
  const fonts = useFontFamily();
  return (
    <View style={{ flex: 1, marginBottom: 12 }}>
      <Text style={[styles.fieldLabel, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.mutedForeground}
        keyboardType={keyboardType ?? "default"}
        editable={editable}
        style={[
          styles.field,
          {
            backgroundColor: editable ? c.surface : c.background,
            borderColor: error ? "#ef4444" : c.border,
            color: editable ? c.foreground : c.mutedForeground,
            fontFamily: fonts.medium,
            textAlign: fonts.isRTL ? "right" : "left",
          },
        ]}
      />
      {error && (
        <Text style={[styles.fieldError, { fontFamily: fonts.medium }]}>{error}</Text>
      )}
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
  section: {
    fontSize: 11,
    letterSpacing: 1.2,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
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
  staticRow: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
  },
  staticLabel: { fontSize: 11, letterSpacing: 1, marginBottom: 6 },
  staticValue: { fontSize: 15 },
  staticHint: { fontSize: 12, marginTop: 6 },
  lockedHint: { fontSize: 12, marginBottom: 10, paddingHorizontal: 4 },
  fieldError: {
    fontSize: 12,
    color: "#ef4444",
    marginTop: 4,
    paddingHorizontal: 4,
  },
  footer: { paddingHorizontal: 24, paddingTop: 12 },
  generalError: {
    fontSize: 13,
    color: "#ef4444",
    textAlign: "center",
    marginBottom: 10,
  },
});
