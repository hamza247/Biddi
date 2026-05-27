import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import CountryFlag from "./CountryFlag";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { DIAL_CODES, type DialCode } from "@/lib/dialCodes";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";

interface Props {
  value: DialCode;
  onChange: (next: DialCode) => void;
}

/** Compact button + bottom-sheet modal that lets the user pick a country
 * dial code. Used by the signup wizard's phone step. */
export function CountryCodePicker({ value, onChange }: Props) {
  const c = useColors();
  const fonts = useFontFamily();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DIAL_CODES;
    return DIAL_CODES.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.dial.includes(q) ||
        d.iso2.toLowerCase().includes(q),
    );
  }, [query]);

  const select = (d: DialCode) => {
    onChange(d);
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={styles.trigger}
        accessibilityRole="button"
        accessibilityLabel={t("login.countryPickerLabel")}
      >
        <CountryFlag isoCode={value.iso2} size={20} style={styles.flag} />
        <Text style={[styles.dial, { color: c.foreground, fontFamily: fonts.semiBold }]}>
          {value.dial}
        </Text>
        <Feather name="chevron-down" size={14} color={c.mutedForeground} />
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={[styles.modalRoot, { backgroundColor: c.background, paddingTop: insets.top + 8 }]}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setOpen(false)} style={styles.iconBtn}>
              <Feather name="x" size={22} color={c.foreground} />
            </Pressable>
            <Text style={[styles.modalTitle, { color: c.foreground, fontFamily: fonts.semiBold }]}>
              {t("login.selectCountry")}
            </Text>
            <View style={{ width: 40 }} />
          </View>

          <View style={[styles.searchWrap, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Feather name="search" size={16} color={c.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("login.searchCountry")}
              placeholderTextColor={c.mutedForeground}
              style={[styles.searchInput, { color: c.foreground, fontFamily: fonts.medium }]}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>

          <FlatList
            data={filtered}
            keyExtractor={(it) => it.iso2}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            renderItem={({ item }) => {
              const active = item.iso2 === value.iso2;
              return (
                <Pressable
                  onPress={() => select(item)}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      backgroundColor: active ? c.primarySoft : pressed ? c.surface : "transparent",
                    },
                  ]}
                >
                  <CountryFlag isoCode={item.iso2} size={22} style={styles.rowFlag} />
                  <Text style={[styles.rowName, { color: c.foreground, fontFamily: fonts.medium }]}>
                    {item.name}
                  </Text>
                  <Text style={[styles.rowDial, { color: c.mutedForeground, fontFamily: fonts.semiBold }]}>
                    {item.dial}
                  </Text>
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingEnd: 4,
  },
  flag: { borderRadius: 3 },
  dial: { fontSize: 18 },
  modalRoot: { flex: 1, paddingHorizontal: 20 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: { fontSize: 17 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    height: 48,
    borderRadius: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    gap: 10,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 16, height: "100%" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 12,
  },
  rowFlag: { borderRadius: 3 },
  rowName: { flex: 1, fontSize: 15 },
  rowDial: { fontSize: 14 },
});
