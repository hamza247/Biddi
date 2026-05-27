import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { api } from "@/lib/api";

interface LevelMeta {
  level: number;
  percentage: number;
  isActive: boolean;
}

interface ByLevel {
  level: number;
  count: number;
  amount: number;
}

interface ReferredUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  joinedAt: string;
  totalEarned: number;
  earningsCount: number;
}

interface ReferralsResp {
  referralCode: string | null;
  totals: { total: number; count: number; byLevel: ByLevel[] };
  referredUsers: ReferredUser[];
  levels: LevelMeta[];
}

interface TreeNode {
  id: string;
  name: string;
  level: number;
  children: TreeNode[];
}

interface TreeResp {
  user: { id: string; name: string };
  children: TreeNode[];
}

const LEVEL_COLORS: Record<number, string> = {
  1: "#2563eb",
  2: "#ea580c",
  3: "#16a34a",
};

function ReferralNode({
  node,
  fonts,
  c,
  isLast,
}: {
  node: TreeNode;
  fonts: ReturnType<typeof useFontFamily>;
  c: ReturnType<typeof useColors>;
  isLast: boolean;
}) {
  const badgeColor = LEVEL_COLORS[node.level] ?? c.primary;
  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View
          style={[
            styles.treeNodeCard,
            { backgroundColor: c.surface, borderColor: c.border },
          ]}
        >
          <Text
            numberOfLines={2}
            style={{
              flex: 1,
              color: c.foreground,
              fontFamily: fonts.semiBold,
              fontSize: 13,
            }}
          >
            {node.name}
          </Text>
          <View style={[styles.levelBadge, { backgroundColor: badgeColor }]}>
            <Text style={[styles.levelBadgeText, { fontFamily: fonts.bold }]}>
              L{node.level}
            </Text>
          </View>
        </View>
      </View>
      {node.children.length > 0 && (
        <View
          style={{
            marginStart: 14,
            paddingStart: 14,
            borderStartWidth: isLast ? 0 : 1,
            borderStartColor: c.border,
          }}
        >
          {node.children.map((child, idx) => (
            <ReferralNode
              key={child.id}
              node={child}
              fonts={fonts}
              c={c}
              isLast={idx === node.children.length - 1}
            />
          ))}
        </View>
      )}
    </View>
  );
}

export default function ReferralsScreen() {
  const c = useColors();
  const fonts = useFontFamily();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [data, setData] = React.useState<ReferralsResp | null>(null);
  const [tree, setTree] = React.useState<TreeResp | null>(null);
  const [treeLoading, setTreeLoading] = React.useState(true);
  const [treeError, setTreeError] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(false);
    setTreeLoading(true);
    setTreeError(false);
    try {
      const resp = await api<ReferralsResp>("/referrals/me");
      setData(resp);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
    try {
      const t = await api<TreeResp>("/referrals/tree");
      setTree(t);
    } catch {
      setTreeError(true);
    } finally {
      setTreeLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const copyCode = async () => {
    if (!data?.referralCode) return;
    await Clipboard.setStringAsync(data.referralCode);
    Alert.alert("Copied", `Your referral code ${data.referralCode} was copied.`);
  };

  const shareCode = async () => {
    if (!data?.referralCode) return;
    try {
      await Share.share({
        message: `Join Biddi using my referral code: ${data.referralCode}`,
      });
    } catch {
      /* user cancelled */
    }
  };

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const byLevelMap = React.useMemo(() => {
    const m = new Map<number, ByLevel>();
    (data?.totals.byLevel ?? []).forEach((r) => m.set(r.level, r));
    return m;
  }, [data]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="x" size={22} color={c.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.foreground, fontFamily: fonts.semiBold }]}>
          Referrals
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        {loading ? (
          <View style={{ paddingVertical: 60, alignItems: "center" }}>
            <ActivityIndicator color={c.primary} />
          </View>
        ) : error || !data ? (
          <View style={{ paddingVertical: 60, alignItems: "center" }}>
            <Text style={{ color: c.mutedForeground, fontFamily: fonts.medium }}>
              Could not load referrals.
            </Text>
            <Pressable onPress={load} style={{ marginTop: 12 }}>
              <Text style={{ color: c.primary, fontFamily: fonts.semiBold }}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={[styles.codeCard, { backgroundColor: c.primarySoft }]}>
              <Text style={[styles.codeLabel, { color: c.primary, fontFamily: fonts.semiBold }]}>
                YOUR REFERRAL CODE
              </Text>
              <Text style={[styles.codeValue, { color: c.foreground, fontFamily: fonts.bold }]}>
                {data.referralCode ?? "—"}
              </Text>
              <View style={{ flexDirection: "row", gap: 12, marginTop: 14 }}>
                <Pressable
                  onPress={copyCode}
                  style={({ pressed }) => [
                    styles.codeBtn,
                    { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  <Feather name="copy" size={16} color="#fff" />
                  <Text style={[styles.codeBtnText, { fontFamily: fonts.semiBold }]}>Copy</Text>
                </Pressable>
                <Pressable
                  onPress={shareCode}
                  style={({ pressed }) => [
                    styles.codeBtn,
                    { backgroundColor: c.foreground, opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  <Feather name="share-2" size={16} color="#fff" />
                  <Text style={[styles.codeBtnText, { fontFamily: fonts.semiBold }]}>Share</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.statsRow}>
              <View style={[styles.statTile, { backgroundColor: c.surface }]}>
                <Text style={[styles.statLabel, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                  Total earned
                </Text>
                <Text style={[styles.statValue, { color: c.foreground, fontFamily: fonts.bold }]}>
                  {fmt(data.totals.total)}
                </Text>
              </View>
              <View style={[styles.statTile, { backgroundColor: c.surface }]}>
                <Text style={[styles.statLabel, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                  Direct referrals
                </Text>
                <Text style={[styles.statValue, { color: c.foreground, fontFamily: fonts.bold }]}>
                  {data.referredUsers.length}
                </Text>
              </View>
            </View>

            <Text
              style={[
                styles.sectionLabel,
                { color: c.mutedForeground, fontFamily: fonts.semiBold },
              ]}
            >
              EARNINGS BY LEVEL
            </Text>
            <View style={styles.levelsRow}>
              {[1, 2, 3].map((lvl) => {
                const meta = data.levels.find((l) => l.level === lvl);
                const stat = byLevelMap.get(lvl);
                return (
                  <View key={lvl} style={[styles.levelTile, { backgroundColor: c.surface }]}>
                    <Text style={[styles.levelTitle, { color: c.foreground, fontFamily: fonts.bold }]}>
                      L{lvl}
                    </Text>
                    <Text
                      style={[styles.levelPct, { color: c.primary, fontFamily: fonts.semiBold }]}
                    >
                      {meta?.isActive ? `${meta.percentage}%` : "—"}
                    </Text>
                    <Text
                      style={[styles.levelAmount, { color: c.foreground, fontFamily: fonts.semiBold }]}
                    >
                      {fmt(stat?.amount ?? 0)}
                    </Text>
                    <Text
                      style={[styles.levelCount, { color: c.mutedForeground, fontFamily: fonts.medium }]}
                    >
                      {stat?.count ?? 0} credits
                    </Text>
                  </View>
                );
              })}
            </View>

            <Text
              style={[
                styles.sectionLabel,
                { color: c.mutedForeground, fontFamily: fonts.semiBold },
              ]}
            >
              YOUR REFERRALS
            </Text>
            <View style={[styles.list, { backgroundColor: c.surface }]}>
              {data.referredUsers.length === 0 ? (
                <Text
                  style={{
                    color: c.mutedForeground,
                    padding: 20,
                    fontFamily: fonts.medium,
                  }}
                >
                  Nobody has joined with your code yet. Share it to start earning when they ride.
                </Text>
              ) : (
                data.referredUsers.map((u, idx) => {
                  const name =
                    `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.phone || "User";
                  return (
                    <View
                      key={u.id}
                      style={[
                        styles.listRow,
                        idx < data.referredUsers.length - 1 && {
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: c.border,
                        },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{ color: c.foreground, fontFamily: fonts.semiBold, fontSize: 14 }}
                        >
                          {name}
                        </Text>
                        <Text
                          style={{
                            color: c.mutedForeground,
                            fontFamily: fonts.medium,
                            fontSize: 12,
                            marginTop: 2,
                          }}
                        >
                          Joined {new Date(u.joinedAt).toLocaleDateString()} ·{" "}
                          {u.earningsCount} {u.earningsCount === 1 ? "ride" : "rides"}
                        </Text>
                      </View>
                      <Text style={{ color: c.foreground, fontFamily: fonts.bold, fontSize: 15 }}>
                        +{fmt(u.totalEarned)}
                      </Text>
                    </View>
                  );
                })
              )}
            </View>

            <Text
              style={[
                styles.sectionLabel,
                { color: c.mutedForeground, fontFamily: fonts.semiBold },
              ]}
            >
              MY REFERRAL TREE
            </Text>
            <View style={[styles.treeContainer, { backgroundColor: c.surface }]}>
              {treeLoading ? (
                <View style={{ paddingVertical: 24, alignItems: "center" }}>
                  <ActivityIndicator color={c.primary} />
                </View>
              ) : treeError || !tree ? (
                <Text
                  style={{
                    color: c.mutedForeground,
                    fontFamily: fonts.medium,
                    paddingVertical: 12,
                  }}
                >
                  Could not load your referral tree.
                </Text>
              ) : tree.children.length === 0 ? (
                <Text
                  style={{
                    color: c.mutedForeground,
                    fontFamily: fonts.medium,
                    paddingVertical: 12,
                  }}
                >
                  No referrals yet.
                </Text>
              ) : (
                <>
                  <View
                    style={[
                      styles.treeRootCard,
                      { backgroundColor: c.primarySoft, borderColor: c.border },
                    ]}
                  >
                    <Text
                      numberOfLines={2}
                      style={{
                        color: c.foreground,
                        fontFamily: fonts.bold,
                        fontSize: 14,
                      }}
                    >
                      {tree.user.name}
                    </Text>
                    <Text
                      style={{
                        color: c.mutedForeground,
                        fontFamily: fonts.medium,
                        fontSize: 11,
                        marginTop: 2,
                      }}
                    >
                      You
                    </Text>
                  </View>
                  <View style={{ marginStart: 14, paddingStart: 14, borderStartWidth: 1, borderStartColor: c.border }}>
                    {tree.children.map((child, idx) => (
                      <ReferralNode
                        key={child.id}
                        node={child}
                        fonts={fonts}
                        c={c}
                        isLast={idx === tree.children.length - 1}
                      />
                    ))}
                  </View>
                </>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18 },
  codeCard: {
    marginHorizontal: 20,
    marginTop: 8,
    borderRadius: 18,
    padding: 20,
    alignItems: "center",
  },
  codeLabel: { fontSize: 11, letterSpacing: 1.4 },
  codeValue: { fontSize: 32, marginTop: 8, letterSpacing: 2 },
  codeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
  },
  codeBtnText: { color: "#fff", fontSize: 14 },
  statsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
    paddingHorizontal: 20,
  },
  statTile: { flex: 1, padding: 16, borderRadius: 14 },
  statLabel: { fontSize: 12 },
  statValue: { fontSize: 22, marginTop: 6 },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 1.2,
    marginTop: 24,
    marginBottom: 8,
    paddingHorizontal: 24,
  },
  levelsRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
  },
  levelTile: {
    flex: 1,
    padding: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  levelTitle: { fontSize: 18 },
  levelPct: { fontSize: 13, marginTop: 2 },
  levelAmount: { fontSize: 16, marginTop: 6 },
  levelCount: { fontSize: 11, marginTop: 2 },
  list: {
    marginHorizontal: 20,
    borderRadius: 14,
    overflow: "hidden",
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  treeContainer: {
    marginHorizontal: 20,
    borderRadius: 14,
    padding: 12,
    paddingBottom: 16,
  },
  treeRootCard: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  treeNodeCard: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  levelBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  levelBadgeText: {
    color: "#fff",
    fontSize: 10,
    letterSpacing: 0.5,
  },
});
