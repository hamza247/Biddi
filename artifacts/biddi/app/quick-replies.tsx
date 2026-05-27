import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import {
  type ChatRole,
  MAX_QUICK_REPLIES,
  MAX_QUICK_REPLY_LENGTH,
  loadQuickReplies,
  resetQuickReplies,
  saveQuickReplies,
} from "@/lib/quickReplies";

type Lists = Record<ChatRole, string[]>;
type Drafts = Record<ChatRole, string>;

export default function QuickRepliesScreen() {
  const c = useColors();
  const { isRTL, ...fonts } = useFontFamily();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { t } = useTranslation();

  const userId = user?.id ?? "";
  const showDriver = !!user && (user.appMode === "driver" || user.driverStatus === "approved");

  const [lists, setLists] = useState<Lists>({ driver: [], rider: [] });
  const [drafts, setDrafts] = useState<Drafts>({ driver: "", rider: "" });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) router.replace("/login");
  }, [user, router]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    Promise.all([
      loadQuickReplies(userId, "driver"),
      loadQuickReplies(userId, "rider"),
    ]).then(([driver, rider]) => {
      if (cancelled) return;
      setLists({ driver, rider });
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!user) return null;

  const persist = async (role: ChatRole, next: string[]) => {
    setLists((prev) => ({ ...prev, [role]: next }));
    if (!userId) return;
    await saveQuickReplies(userId, role, next);
  };

  const handleAdd = async (role: ChatRole) => {
    const draft = (drafts[role] ?? "").trim();
    if (!draft) return;
    if (lists[role].length >= MAX_QUICK_REPLIES) {
      Alert.alert(
        t("quickReplies.maxTitle", { defaultValue: "List is full" }),
        t("quickReplies.maxBody", {
          defaultValue: "You can save up to {{count}} quick replies per role.",
          count: MAX_QUICK_REPLIES,
        }),
      );
      return;
    }
    const next = [...lists[role], draft.slice(0, MAX_QUICK_REPLY_LENGTH)];
    setDrafts((prev) => ({ ...prev, [role]: "" }));
    await persist(role, next);
  };

  const handleRemove = async (role: ChatRole, index: number) => {
    const next = lists[role].filter((_, i) => i !== index);
    await persist(role, next);
  };

  const handleEdit = async (role: ChatRole, index: number, value: string) => {
    const next = lists[role].slice();
    next[index] = value.slice(0, MAX_QUICK_REPLY_LENGTH);
    setLists((prev) => ({ ...prev, [role]: next }));
  };

  const commitEdit = async (role: ChatRole, index: number) => {
    const cleaned = lists[role][index]?.trim() ?? "";
    const next = lists[role].slice();
    if (!cleaned) {
      next.splice(index, 1);
    } else {
      next[index] = cleaned;
    }
    await persist(role, next);
  };

  const move = async (role: ChatRole, index: number, dir: -1 | 1) => {
    const target = index + dir;
    const arr = lists[role];
    if (target < 0 || target >= arr.length) return;
    const next = arr.slice();
    [next[index], next[target]] = [next[target], next[index]];
    await persist(role, next);
  };

  const handleReset = (role: ChatRole) => {
    Alert.alert(
      t("quickReplies.resetTitle", { defaultValue: "Reset to defaults?" }),
      t("quickReplies.resetBody", {
        defaultValue: "Your custom quick replies for this role will be replaced with the built-in list.",
      }),
      [
        { text: t("common.cancel", { defaultValue: "Cancel" }), style: "cancel" },
        {
          text: t("quickReplies.resetConfirm", { defaultValue: "Reset" }),
          style: "destructive",
          onPress: async () => {
            if (!userId) return;
            const defaults = await resetQuickReplies(userId, role);
            setLists((prev) => ({ ...prev, [role]: defaults }));
          },
        },
      ],
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="x" size={22} color={c.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.foreground, fontFamily: fonts.semiBold }]}>
          {t("quickReplies.title", { defaultValue: "Quick Replies" })}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.intro, { color: c.mutedForeground, fontFamily: fonts.medium, lineHeight: fonts.getBodyLineHeight(13) }]}>
          {t("quickReplies.intro", {
            defaultValue:
              "Customise the tap-to-send phrases that appear above the chat input. Add your own, remove what you don't use, and reorder by priority.",
          })}
        </Text>

        {loaded && (
          <>
            <RoleEditor
              role="rider"
              title={t("quickReplies.riderTitle", { defaultValue: "As a rider" })}
              hint={t("quickReplies.riderHint", { defaultValue: "Shown when chatting with your driver." })}
              items={lists.rider}
              draft={drafts.rider}
              onDraftChange={(v) => setDrafts((p) => ({ ...p, rider: v }))}
              onAdd={() => handleAdd("rider")}
              onRemove={(i) => handleRemove("rider", i)}
              onEdit={(i, v) => handleEdit("rider", i, v)}
              onCommitEdit={(i) => commitEdit("rider", i)}
              onMove={(i, d) => move("rider", i, d)}
              onReset={() => handleReset("rider")}
              isRTL={isRTL}
            />

            {showDriver && (
              <RoleEditor
                role="driver"
                title={t("quickReplies.driverTitle", { defaultValue: "As a driver" })}
                hint={t("quickReplies.driverHint", { defaultValue: "Shown when chatting with your rider." })}
                items={lists.driver}
                draft={drafts.driver}
                onDraftChange={(v) => setDrafts((p) => ({ ...p, driver: v }))}
                onAdd={() => handleAdd("driver")}
                onRemove={(i) => handleRemove("driver", i)}
                onEdit={(i, v) => handleEdit("driver", i, v)}
                onCommitEdit={(i) => commitEdit("driver", i)}
                onMove={(i, d) => move("driver", i, d)}
                onReset={() => handleReset("driver")}
                isRTL={isRTL}
              />
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

interface RoleEditorProps {
  role: ChatRole;
  title: string;
  hint: string;
  items: string[];
  draft: string;
  onDraftChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onEdit: (index: number, value: string) => void;
  onCommitEdit: (index: number) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onReset: () => void;
  isRTL: boolean;
}

function RoleEditor({
  title,
  hint,
  items,
  draft,
  onDraftChange,
  onAdd,
  onRemove,
  onEdit,
  onCommitEdit,
  onMove,
  onReset,
  isRTL,
}: RoleEditorProps) {
  const c = useColors();
  const fonts = useFontFamily();
  const { t } = useTranslation();
  const atMax = items.length >= MAX_QUICK_REPLIES;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.sectionTitle, { color: c.foreground, fontFamily: fonts.semiBold }]}>
            {title}
          </Text>
          <Text style={[styles.sectionHint, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
            {hint}
          </Text>
        </View>
        <Pressable onPress={onReset} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <Text style={[styles.resetText, { color: c.primary, fontFamily: fonts.semiBold }]}>
            {t("quickReplies.reset", { defaultValue: "Reset" })}
          </Text>
        </Pressable>
      </View>

      <View style={[styles.list, { backgroundColor: c.surface, borderColor: c.border }]}>
        {items.length === 0 && (
          <Text style={[styles.empty, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
            {t("quickReplies.empty", {
              defaultValue: "No quick replies yet. Add one below.",
            })}
          </Text>
        )}
        {items.map((item, index) => (
          <View
            key={`${index}`}
            style={[
              styles.row,
              {
                borderBottomColor: c.border,
                borderBottomWidth: index === items.length - 1 ? 0 : StyleSheet.hairlineWidth,
              },
            ]}
          >
            <View style={styles.reorderCol}>
              <Pressable
                onPress={() => onMove(index, -1)}
                disabled={index === 0}
                hitSlop={6}
                style={{ opacity: index === 0 ? 0.3 : 1 }}
              >
                <Feather name="chevron-up" size={18} color={c.mutedForeground} />
              </Pressable>
              <Pressable
                onPress={() => onMove(index, 1)}
                disabled={index === items.length - 1}
                hitSlop={6}
                style={{ opacity: index === items.length - 1 ? 0.3 : 1 }}
              >
                <Feather name="chevron-down" size={18} color={c.mutedForeground} />
              </Pressable>
            </View>
            <TextInput
              value={item}
              onChangeText={(v) => onEdit(index, v)}
              onBlur={() => onCommitEdit(index)}
              maxLength={MAX_QUICK_REPLY_LENGTH}
              style={[
                styles.rowInput,
                {
                  color: c.foreground,
                  fontFamily: fonts.medium,
                  textAlign: isRTL ? "right" : "left",
                },
              ]}
              returnKeyType="done"
            />
            <Pressable onPress={() => onRemove(index)} hitSlop={8} style={styles.removeBtn}>
              <Feather name="trash-2" size={18} color={c.mutedForeground} />
            </Pressable>
          </View>
        ))}
      </View>

      <View style={[styles.addRow, { backgroundColor: c.surface, borderColor: c.border }]}>
        <TextInput
          value={draft}
          onChangeText={onDraftChange}
          placeholder={t("quickReplies.addPlaceholder", { defaultValue: "Add a new quick reply" })}
          placeholderTextColor={c.mutedForeground}
          maxLength={MAX_QUICK_REPLY_LENGTH}
          editable={!atMax}
          style={[
            styles.addInput,
            {
              color: c.foreground,
              fontFamily: fonts.medium,
              textAlign: isRTL ? "right" : "left",
            },
          ]}
          returnKeyType="done"
          onSubmitEditing={onAdd}
        />
        <Pressable
          onPress={onAdd}
          disabled={atMax || draft.trim().length === 0}
          style={({ pressed }) => [
            styles.addBtn,
            {
              backgroundColor: c.primary,
              opacity: atMax || draft.trim().length === 0 ? 0.4 : pressed ? 0.8 : 1,
            },
          ]}
        >
          <Feather name="plus" size={18} color={c.primaryForeground} />
        </Pressable>
      </View>
      <Text style={[styles.counter, { color: c.mutedForeground, fontFamily: fonts.regular }]}>
        {t("quickReplies.count", {
          defaultValue: "{{used}} of {{max}} used",
          used: items.length,
          max: MAX_QUICK_REPLIES,
        })}
      </Text>
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
  intro: { fontSize: 13, lineHeight: 18, marginBottom: 16, paddingHorizontal: 4 },
  section: { marginBottom: 28 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 10,
    paddingHorizontal: 4,
    gap: 12,
  },
  sectionTitle: { fontSize: 15 },
  sectionHint: { fontSize: 12, marginTop: 2 },
  resetText: { fontSize: 13 },
  list: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  empty: { fontSize: 13, padding: 16, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
  },
  reorderCol: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 2,
  },
  rowInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  removeBtn: { padding: 8 },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingStart: 12,
    paddingEnd: 6,
    paddingVertical: 6,
    gap: 8,
  },
  addInput: { flex: 1, fontSize: 14, paddingVertical: 8 },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  counter: { fontSize: 11, marginTop: 6, paddingHorizontal: 4 },
});
