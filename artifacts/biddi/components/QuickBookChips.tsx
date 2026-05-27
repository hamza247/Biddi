import React, { useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";

import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import type { Place, SavedPlace } from "@/lib/types";

const CANONICAL = [
  {
    key: "home",
    icon: "home" as const,
    labelKey: "riderHome.home",
    defaultLabel: "Home",
  },
  {
    key: "work",
    icon: "briefcase" as const,
    labelKey: "riderHome.work",
    defaultLabel: "Work",
  },
  {
    key: "airport",
    icon: "send" as const,
    labelKey: "riderHome.airport",
    defaultLabel: "Airport",
  },
] as const;

function findSaved(
  places: SavedPlace[],
  key: string,
): SavedPlace | undefined {
  return places.find((p) => p.label.toLowerCase() === key);
}

export interface QuickBookChipsProps {
  savedPlaces: SavedPlace[];
  onBookFavorite: (place: Place) => void;
  onAddFavorite: (key: string, defaultLabel: string) => void;
  onEditFavorite: (place: SavedPlace) => void;
  onDeleteFavorite: (place: SavedPlace) => void;
}

export function QuickBookChips({
  savedPlaces,
  onBookFavorite,
  onAddFavorite,
  onEditFavorite,
  onDeleteFavorite,
}: QuickBookChipsProps) {
  const c = useColors();
  const fonts = useFontFamily();
  const { t } = useTranslation();
  const [menuPlace, setMenuPlace] = useState<SavedPlace | null>(null);

  const canonicalKeys = CANONICAL.map((ch) => ch.key as string);
  const extraSaved = savedPlaces.find(
    (p) => !canonicalKeys.includes(p.label.toLowerCase()),
  );

  function handleLongPress(place: SavedPlace) {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    setMenuPlace(place);
  }

  function closeMenu() {
    setMenuPlace(null);
  }

  function handleEdit() {
    if (!menuPlace) return;
    closeMenu();
    onEditFavorite(menuPlace);
  }

  function handleDelete() {
    if (!menuPlace) return;
    const place = menuPlace;
    closeMenu();
    onDeleteFavorite(place);
  }

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        style={styles.scroll}
      >
        {CANONICAL.map((canon) => {
          const saved = findSaved(savedPlaces, canon.key);
          const label = t(canon.labelKey, { defaultValue: canon.defaultLabel });

          if (saved) {
            return (
              <Pressable
                key={canon.key}
                onPress={() => onBookFavorite(saved)}
                onLongPress={() => handleLongPress(saved)}
                delayLongPress={400}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: pressed ? c.primarySoft : c.surface,
                    borderColor: c.primary,
                    borderWidth: 1.5,
                  },
                ]}
              >
                <View
                  style={[styles.chipIcon, { backgroundColor: c.primarySoft }]}
                >
                  <Feather name={canon.icon} size={13} color={c.primary} />
                </View>
                <Text
                  style={[
                    styles.chipLabel,
                    { color: c.primary, fontFamily: fonts.semiBold },
                  ]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </Pressable>
            );
          }

          return (
            <Pressable
              key={canon.key}
              onPress={() => onAddFavorite(canon.key, canon.defaultLabel)}
              style={({ pressed }) => [
                styles.chip,
                styles.addChip,
                {
                  backgroundColor: pressed ? c.muted : "transparent",
                  borderColor: c.border,
                },
              ]}
            >
              <Feather name="plus" size={12} color={c.mutedForeground} />
              <Text
                style={[
                  styles.chipLabel,
                  { color: c.mutedForeground, fontFamily: fonts.medium },
                ]}
                numberOfLines={1}
              >
                {t(`riderHome.add_${canon.key}`, {
                  defaultValue: `Add ${canon.defaultLabel}`,
                })}
              </Text>
            </Pressable>
          );
        })}

        {extraSaved && (
          <Pressable
            key={extraSaved.id}
            onPress={() => onBookFavorite(extraSaved)}
            onLongPress={() => handleLongPress(extraSaved)}
            delayLongPress={400}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: pressed ? c.primarySoft : c.surface,
                borderColor: c.primary,
                borderWidth: 1.5,
              },
            ]}
          >
            <View style={[styles.chipIcon, { backgroundColor: c.primarySoft }]}>
              <Feather name="bookmark" size={13} color={c.primary} />
            </View>
            <Text
              style={[
                styles.chipLabel,
                { color: c.primary, fontFamily: fonts.semiBold },
              ]}
              numberOfLines={1}
            >
              {extraSaved.label || extraSaved.address.split(",")[0]}
            </Text>
          </Pressable>
        )}
      </ScrollView>

      <Modal
        visible={menuPlace !== null}
        transparent
        animationType="fade"
        onRequestClose={closeMenu}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={closeMenu}>
          <Pressable style={[styles.sheet, { backgroundColor: c.surface }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: c.border }]} />

            <Text style={[styles.sheetTitle, { color: c.foreground, fontFamily: fonts.semiBold }]} numberOfLines={1}>
              {menuPlace?.label}
            </Text>

            <Text style={[styles.sheetAddress, { color: c.mutedForeground, fontFamily: fonts.regular }]} numberOfLines={2}>
              {menuPlace?.address}
            </Text>

            <View style={[styles.divider, { backgroundColor: c.border }]} />

            <Pressable
              onPress={handleEdit}
              style={({ pressed }) => [
                styles.sheetAction,
                { backgroundColor: pressed ? c.muted : "transparent" },
              ]}
            >
              <View style={[styles.sheetActionIcon, { backgroundColor: c.primarySoft }]}>
                <Feather name="edit-2" size={16} color={c.primary} />
              </View>
              <Text style={[styles.sheetActionLabel, { color: c.foreground, fontFamily: fonts.medium }]}>
                {t("riderHome.editPlace", { defaultValue: "Edit location" })}
              </Text>
              <Feather name="chevron-right" size={16} color={c.mutedForeground} />
            </Pressable>

            <Pressable
              onPress={handleDelete}
              style={({ pressed }) => [
                styles.sheetAction,
                { backgroundColor: pressed ? c.muted : "transparent" },
              ]}
            >
              <View style={[styles.sheetActionIcon, { backgroundColor: "#FEE2E2" }]}>
                <Feather name="trash-2" size={16} color="#EF4444" />
              </View>
              <Text style={[styles.sheetActionLabel, { color: "#EF4444", fontFamily: fonts.medium }]}>
                {t("riderHome.deletePlace", { defaultValue: "Remove saved place" })}
              </Text>
            </Pressable>

            <Pressable
              onPress={closeMenu}
              style={({ pressed }) => [
                styles.cancelBtn,
                {
                  backgroundColor: pressed ? c.muted : c.muted,
                  marginTop: 8,
                },
              ]}
            >
              <Text style={[styles.cancelLabel, { color: c.foreground, fontFamily: fonts.semiBold }]}>
                {t("common.cancel", { defaultValue: "Cancel" })}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { marginBottom: 10 },
  row: {
    flexDirection: "row",
    paddingHorizontal: 4,
    gap: 8,
    alignItems: "center",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  addChip: {
    borderWidth: 1,
    borderStyle: "dashed",
  },
  chipIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  chipLabel: {
    fontSize: 13,
    maxWidth: 80,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 36 : 24,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 16,
    marginBottom: 4,
  },
  sheetAddress: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  divider: {
    height: 1,
    marginBottom: 8,
  },
  sheetAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderRadius: 12,
  },
  sheetActionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetActionLabel: {
    flex: 1,
    fontSize: 15,
  },
  cancelBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  cancelLabel: {
    fontSize: 15,
  },
});
