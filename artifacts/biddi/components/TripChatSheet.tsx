import { Feather } from "@expo/vector-icons";
import { Audio, AVPlaybackStatus } from "expo-av";
import * as ImagePicker from "expo-image-picker";
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  FlatList,
  Image,
  Keyboard,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView, KeyboardProvider } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { useColors } from "@/hooks/useColors";
import { useFontFamily } from "@/hooks/useFontFamily";
import { ApiError, api, getBaseUrl } from "@/lib/api";
import {
  type QueuedMessage,
  isTransientSendError,
  loadQueue,
  nextBackoffMs,
  saveQueue,
} from "@/lib/chatQueue";
import { type ChatRole, getDefaultQuickReplies, loadQuickReplies } from "@/lib/quickReplies";
import { connectSocket, getSocket } from "@/lib/socket";
import { ReconnectContext } from "@/context/AppContext";

interface ChatMessage {
  id: string;
  tripId: string;
  senderId: string;
  type: "text" | "image" | "voice";
  content: string;
  audioDurationMs?: number | null;
  deliveredAt?: string | null;
  readAt?: string | null;
  createdAt: string;
  senderFirstName: string;
  senderLastName: string;
  /** Optimistic-only: client-generated id used to reconcile the server echo. */
  clientId?: string | null;
  /** Optimistic-only delivery status. */
  status?: "sending" | "queued" | "sent" | "failed";
  /** Optimistic-only: per-message upload progress (0..1). */
  uploadProgress?: number;
  /** Optimistic-only: local file URI for retry of media sends. */
  _localUri?: string;
  _contentType?: string;
  _fileName?: string;
  _fileSize?: number;
}

interface Props {
  tripId: string;
  userId: string;
  peerName: string;
  isOpen: boolean;
  onClose: () => void;
  /** Called when the local unread count for this trip should reset to 0. */
  onChatRead?: () => void;
  /** Which side of the trip is opening the chat — drives quick-reply suggestions. */
  role: ChatRole;
}

const TYPING_THROTTLE_MS = 1500;
const TYPING_TIMEOUT_MS = 2000;

async function requestChatUploadUrl(tripId: string, contentType: string, size: number, name: string) {
  return api<{ uploadURL: string; objectPath: string }>("/storage/uploads/chat-request-url", {
    method: "POST",
    json: { tripId, name, size, contentType },
  });
}

async function finalizeChatUpload(tripId: string, objectPath: string) {
  return api<{ objectPath: string }>("/storage/uploads/chat-finalize", {
    method: "POST",
    json: { tripId, objectPath },
  });
}

function uploadWithProgress(
  uploadURL: string,
  blob: Blob,
  contentType: string,
  onProgress?: (frac: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadURL);
    xhr.setRequestHeader("Content-Type", contentType);
    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Upload failed: network"));
    xhr.send(blob);
  });
}

async function uploadToPresignedUrl(
  uploadURL: string,
  uriOrBlob: string | Blob,
  contentType: string,
  onProgress?: (frac: number) => void,
): Promise<void> {
  const blob = typeof uriOrBlob === "string" ? await fetch(uriOrBlob).then((r) => r.blob()) : uriOrBlob;
  await uploadWithProgress(uploadURL, blob, contentType, onProgress);
}

function resolveObjectUrl(content: string): string {
  if (content.startsWith("http") || content.startsWith("file:") || content.startsWith("data:")) {
    return content;
  }
  const base = getBaseUrl();
  return `${base}/storage/objects/${content.replace(/^\/objects\//, "")}`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function makeClientId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function VoiceMessagePlayer({ content, durationHintMs }: { content: string; durationHintMs?: number | null }) {
  const c = useColors();
  const fonts = useFontFamily();
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [durationMs, setDurationMs] = useState(durationHintMs ?? 0);
  const [positionMs, setPositionMs] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    return () => {
      sound?.unloadAsync().catch(() => {});
    };
  }, [sound]);

  const handlePlayPause = async () => {
    if (isLoading) return;
    try {
      if (!sound) {
        setIsLoading(true);
        const url = resolveObjectUrl(content);
        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: url },
          { shouldPlay: true },
          (status: AVPlaybackStatus) => {
            if (status.isLoaded) {
              setPositionMs(status.positionMillis ?? 0);
              setDurationMs(status.durationMillis ?? durationHintMs ?? 0);
              setIsPlaying(status.isPlaying);
              if (status.didJustFinish) {
                setIsPlaying(false);
                setPositionMs(0);
              }
            }
          },
        );
        setSound(newSound);
        setIsLoading(false);
        setIsPlaying(true);
      } else if (isPlaying) {
        await sound.pauseAsync();
        setIsPlaying(false);
      } else {
        await sound.playFromPositionAsync(positionMs === durationMs && durationMs > 0 ? 0 : positionMs);
        setIsPlaying(true);
      }
    } catch {
      setIsLoading(false);
    }
  };

  const progress = durationMs > 0 ? positionMs / durationMs : 0;

  return (
    <Pressable style={[voiceStyles.container, { backgroundColor: c.surface }]} onPress={handlePlayPause}>
      <View style={[voiceStyles.iconWrap, { backgroundColor: c.primarySoft }]}>
        {isLoading ? (
          <ActivityIndicator size="small" color={c.primary} />
        ) : (
          <Feather name={isPlaying ? "pause" : "play"} size={16} color={c.primary} />
        )}
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={[voiceStyles.track, { backgroundColor: c.border }]}>
          <View
            style={[
              voiceStyles.fill,
              { backgroundColor: c.primary, width: `${progress * 100}%` },
            ]}
          />
        </View>
        <Text style={[voiceStyles.duration, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
          {durationMs > 0 ? formatDuration(durationMs) : "--:--"}
        </Text>
      </View>
    </Pressable>
  );
}

const voiceStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    minWidth: 160,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  fill: {
    height: 4,
    borderRadius: 2,
  },
  duration: { fontSize: 11 },
});

/**
 * Tick-receipt indicator for outbound messages.
 *  - failed:   red exclamation (with retry button shown alongside the bubble)
 *  - sending:  hollow clock
 *  - sent:     single grey ✓ (server accepted, peer offline)
 *  - delivered: double grey ✓✓ (peer socket online)
 *  - read:     double blue ✓✓ (peer opened the chat)
 */
function ReceiptTicks({
  message,
  primary,
  muted,
  accent,
  fontFamily,
}: {
  message: ChatMessage;
  primary: string;
  muted: string;
  accent: string;
  fontFamily: string;
}) {
  if (message.status === "failed") {
    return (
      <Text style={[bubbleStyles.tick, { color: accent, fontFamily }]}>!</Text>
    );
  }
  if (message.status === "queued") {
    return <Feather name="wifi-off" size={11} color={muted} />;
  }
  if (message.status === "sending") {
    return <Feather name="clock" size={11} color={muted} />;
  }
  if (message.readAt) {
    return (
      <Text style={[bubbleStyles.tick, { color: primary, fontFamily }]}>✓✓</Text>
    );
  }
  if (message.deliveredAt) {
    return (
      <Text style={[bubbleStyles.tick, { color: muted, fontFamily }]}>✓✓</Text>
    );
  }
  return (
    <Text style={[bubbleStyles.tick, { color: muted, fontFamily }]}>✓</Text>
  );
}

function MessageBubble({
  message,
  isMine,
  onRetry,
}: {
  message: ChatMessage;
  isMine: boolean;
  onRetry?: (msg: ChatMessage) => void;
}) {
  const c = useColors();
  const fonts = useFontFamily();
  const { t } = useTranslation();
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);

  const bubbleBg = isMine ? c.primary : c.surface;
  const bubbleText = isMine ? c.primaryForeground : c.foreground;

  return (
    <View
      style={[
        bubbleStyles.wrap,
        isMine ? bubbleStyles.wrapMine : bubbleStyles.wrapOther,
      ]}
    >
      {message.type === "text" && (
        <View style={[bubbleStyles.bubble, { backgroundColor: bubbleBg }]}>
          <Text style={[bubbleStyles.text, { color: bubbleText, fontFamily: fonts.regular, lineHeight: fonts.getBodyLineHeight(15) }]}>
            {message.content}
          </Text>
        </View>
      )}

      {message.type === "image" && (
        <>
          <Pressable
            style={[bubbleStyles.imageBubble, { backgroundColor: c.surface }]}
            onPress={() =>
              message.status === "sending"
                ? null
                : setLightboxUri(resolveObjectUrl(message.content))
            }
          >
            <Image
              source={{ uri: resolveObjectUrl(message.content) }}
              style={bubbleStyles.image}
              resizeMode="cover"
            />
            {message.status === "sending" && (
              <View style={bubbleStyles.imageOverlay}>
                <ActivityIndicator size="small" color="#fff" />
                <View style={bubbleStyles.progressTrack}>
                  <View
                    style={[
                      bubbleStyles.progressFill,
                      { width: `${Math.round((message.uploadProgress ?? 0) * 100)}%` },
                    ]}
                  />
                </View>
              </View>
            )}
          </Pressable>
          <Modal
            visible={lightboxUri !== null}
            transparent
            animationType="fade"
            onRequestClose={() => setLightboxUri(null)}
          >
            <Pressable style={bubbleStyles.lightboxBackdrop} onPress={() => setLightboxUri(null)}>
              {lightboxUri && (
                <Image
                  source={{ uri: lightboxUri }}
                  style={bubbleStyles.lightboxImage}
                  resizeMode="contain"
                />
              )}
            </Pressable>
          </Modal>
        </>
      )}

      {message.type === "voice" && (
        <View>
          <VoiceMessagePlayer content={message.content} durationHintMs={message.audioDurationMs} />
          {message.status === "sending" && (
            <View style={[bubbleStyles.voiceProgressTrack, { backgroundColor: c.border }]}>
              <View
                style={[
                  bubbleStyles.voiceProgressFill,
                  {
                    backgroundColor: c.primary,
                    width: `${Math.round((message.uploadProgress ?? 0) * 100)}%`,
                  },
                ]}
              />
            </View>
          )}
        </View>
      )}

      <View style={bubbleStyles.metaRow}>
        <Text
          style={[
            bubbleStyles.time,
            { color: c.mutedForeground, fontFamily: fonts.regular },
          ]}
        >
          {new Date(message.createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Text>
        {isMine && (
          <ReceiptTicks
            message={message}
            primary="#3b82f6"
            muted={c.mutedForeground}
            accent={c.accent}
            fontFamily={fonts.medium}
          />
        )}
        {isMine && message.status === "queued" && (
          <View style={[bubbleStyles.queuedBadge, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[bubbleStyles.queuedBadgeText, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
              {t("tripChat.queued")}
            </Text>
          </View>
        )}
        {isMine && message.status === "failed" && onRetry && (
          <Pressable onPress={() => onRetry(message)} hitSlop={6}>
            <Feather name="refresh-cw" size={11} color={c.accent} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const bubbleStyles = StyleSheet.create({
  wrap: { marginVertical: 3, maxWidth: "75%" },
  wrapMine: { alignSelf: "flex-end", alignItems: "flex-end" },
  wrapOther: { alignSelf: "flex-start", alignItems: "flex-start" },
  lightboxBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  lightboxImage: {
    width: "100%",
    height: "80%",
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  text: { fontSize: 15, lineHeight: 21 },
  imageBubble: { borderRadius: 14, overflow: "hidden", position: "relative" },
  image: { width: 180, height: 180 },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  progressTrack: {
    width: "100%",
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.3)",
    overflow: "hidden",
  },
  progressFill: { height: 3, backgroundColor: "#fff" },
  voiceProgressTrack: {
    height: 3,
    borderRadius: 2,
    overflow: "hidden",
    marginTop: 4,
  },
  voiceProgressFill: { height: 3 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 3,
    marginHorizontal: 4,
  },
  time: { fontSize: 11 },
  tick: { fontSize: 11, lineHeight: 13 },
  queuedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  queuedBadgeText: { fontSize: 10, lineHeight: 12 },
});

export function TripChatSheet({
  tripId,
  userId,
  peerName,
  isOpen,
  onClose,
  onChatRead,
  role,
}: Props) {
  const c = useColors();
  const fonts = useFontFamily();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { reconnectKey } = useContext(ReconnectContext);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [isPeerTyping, setIsPeerTyping] = useState(false);

  const listRef = useRef<FlatList<ChatMessage>>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isOpenRef = useRef(isOpen);
  const isAtBottomRef = useRef(true);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const lastTypingSentAtRef = useRef(0);
  const peerTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Persistent outbound queue: clientId -> QueuedMessage. Survives backgrounding. */
  const queueRef = useRef<Map<string, QueuedMessage>>(new Map());
  /** Active retry timers per queued message. */
  const retryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /** Stable refs to send functions so retries can call them without circular deps. */
  const sendTextRef = useRef<((content: string, retryClientId?: string) => void) | null>(null);
  const sendImageRef = useRef<
    | ((localUri: string, contentType: string, name: string, size: number, retryClientId?: string) => void)
    | null
  >(null);
  const sendVoiceRef = useRef<((localUri: string, durationMs: number, retryClientId?: string) => void) | null>(null);

  const foregroundHandlerRef = useRef<((msg: ChatMessage) => void) | null>(null);
  const readHandlerRef = useRef<((p: { tripId: string; messageIds: string[]; readAt: string }) => void) | null>(null);
  const deliveredHandlerRef = useRef<((p: { tripId: string; messageIds: string[]; deliveredAt: string }) => void) | null>(null);
  const typingStartHandlerRef = useRef<((p: { tripId: string; userId: string }) => void) | null>(null);
  const typingStopHandlerRef = useRef<((p: { tripId: string; userId: string }) => void) | null>(null);

  /**
   * Mark every visible peer message as read on the server. Triggered when the
   * sheet is opened, when a new peer message arrives while the sheet is open,
   * and when the socket reconnects mid-session.
   */
  const markRead = useCallback(
    async (upToMessageId?: string) => {
      onChatRead?.();
      try {
        await api(`/trips/${tripId}/messages/mark-read`, {
          method: "POST",
          json: upToMessageId ? { upToMessageId } : {},
        });
      } catch {
      }
    },
    [tripId, onChatRead],
  );

  const addMessage = useCallback(
    (msg: ChatMessage) => {
      const isNew = !seenMessageIdsRef.current.has(msg.id);
      if (isNew) {
        seenMessageIdsRef.current.add(msg.id);
      }
      setMessages((prev) => {
        if (msg.clientId) {
          const idx = prev.findIndex((m) => m.clientId === msg.clientId);
          if (idx >= 0) {
            const next = prev.slice();
            next[idx] = { ...msg, status: "sent" };
            return next;
          }
        }
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      if (msg.clientId && queueRef.current.has(msg.clientId)) {
        const tmr = retryTimersRef.current.get(msg.clientId);
        if (tmr) clearTimeout(tmr);
        retryTimersRef.current.delete(msg.clientId);
        queueRef.current.delete(msg.clientId);
        void saveQueue(tripId, Array.from(queueRef.current.values()));
      }
      if (!isNew) return;
      if (isAtBottomRef.current) {
        setTimeout(() => {
          listRef.current?.scrollToEnd({ animated: true });
        }, 100);
      } else if (msg.senderId !== userId) {
        setNewMessageCount((n) => n + 1);
      }

      if (msg.senderId !== userId) {
        if (peerTypingTimerRef.current) {
          clearTimeout(peerTypingTimerRef.current);
          peerTypingTimerRef.current = null;
        }
        setIsPeerTyping(false);
        if (isOpenRef.current) void markRead(msg.id);
      }
    },
    [userId, markRead],
  );

  /**
   * Persist the in-memory outbound queue for this trip so that pending
   * messages survive app backgrounding/foregrounding (and process restarts).
   */
  const persistQueue = useCallback(async () => {
    await saveQueue(tripId, Array.from(queueRef.current.values()));
  }, [tripId]);

  /** Mark a message as queued in the UI and (re)schedule its retry. */
  const markQueuedAndScheduleRetry = useCallback(
    (queued: QueuedMessage) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.clientId === queued.clientId
            ? { ...m, status: "queued", uploadProgress: undefined }
            : m,
        ),
      );
      const existing = retryTimersRef.current.get(queued.clientId);
      if (existing) clearTimeout(existing);
      const delay = nextBackoffMs(queued.attempts);
      const timer = setTimeout(() => {
        retryTimersRef.current.delete(queued.clientId);
        const current = queueRef.current.get(queued.clientId);
        if (!current) return;
        if (current.type === "text") {
          sendTextRef.current?.(current.content, current.clientId);
        } else if (current.type === "image") {
          sendImageRef.current?.(
            current.content,
            current.contentType ?? "image/jpeg",
            current.fileName ?? "photo.jpg",
            current.fileSize ?? 0,
            current.clientId,
          );
        } else if (current.type === "voice") {
          sendVoiceRef.current?.(
            current.content,
            current.audioDurationMs ?? 0,
            current.clientId,
          );
        }
      }, delay);
      retryTimersRef.current.set(queued.clientId, timer);
    },
    [],
  );

  /** Trigger an immediate retry of every queued message (e.g. on reconnect). */
  const flushQueue = useCallback(() => {
    for (const queued of Array.from(queueRef.current.values())) {
      const t = retryTimersRef.current.get(queued.clientId);
      if (t) clearTimeout(t);
      retryTimersRef.current.delete(queued.clientId);
      if (queued.type === "text") {
        sendTextRef.current?.(queued.content, queued.clientId);
      } else if (queued.type === "image") {
        sendImageRef.current?.(
          queued.content,
          queued.contentType ?? "image/jpeg",
          queued.fileName ?? "photo.jpg",
          queued.fileSize ?? 0,
          queued.clientId,
        );
      } else if (queued.type === "voice") {
        sendVoiceRef.current?.(
          queued.content,
          queued.audioDurationMs ?? 0,
          queued.clientId,
        );
      }
    }
  }, []);

  /** Remove a successfully-delivered message from the persistent queue. */
  const removeFromQueue = useCallback(
    (clientId: string) => {
      const t = retryTimersRef.current.get(clientId);
      if (t) clearTimeout(t);
      retryTimersRef.current.delete(clientId);
      if (queueRef.current.delete(clientId)) {
        void persistQueue();
      }
    },
    [persistQueue],
  );

  /** Common error handler: classify, persist queue updates, schedule retry. */
  const handleSendError = useCallback(
    (queued: QueuedMessage, err: unknown) => {
      if (!isTransientSendError(err)) {
        setMessages((prev) =>
          prev.map((m) =>
            m.clientId === queued.clientId
              ? { ...m, status: "failed", uploadProgress: undefined }
              : m,
          ),
        );
        removeFromQueue(queued.clientId);
        return;
      }
      const updated: QueuedMessage = { ...queued, attempts: queued.attempts + 1 };
      queueRef.current.set(queued.clientId, updated);
      void persistQueue();
      markQueuedAndScheduleRetry(updated);
    },
    [persistQueue, markQueuedAndScheduleRetry, removeFromQueue],
  );

  const applyReadReceipt = useCallback((messageIds: string[], readAt: string) => {
    if (messageIds.length === 0) return;
    const ids = new Set(messageIds);
    setMessages((prev) =>
      prev.map((m) => (ids.has(m.id) ? { ...m, readAt, deliveredAt: m.deliveredAt ?? readAt } : m)),
    );
  }, []);

  const applyDeliveredReceipt = useCallback((messageIds: string[], deliveredAt: string) => {
    if (messageIds.length === 0) return;
    const ids = new Set(messageIds);
    setMessages((prev) =>
      prev.map((m) => (ids.has(m.id) && !m.deliveredAt ? { ...m, deliveredAt } : m)),
    );
  }, []);

  const scrollToLatest = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
    setNewMessageCount(0);
    setIsAtBottom(true);
    isAtBottomRef.current = true;
  }, []);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const atBottom = distanceFromBottom < 30;
    if (atBottom !== isAtBottomRef.current) {
      isAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
      if (atBottom) {
        setNewMessageCount(0);
      }
    }
  }, []);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      listRef.current?.scrollToEnd({ animated: true });
    });
    return () => sub.remove();
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) return;
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    const rec = recordingRef.current;
    if (rec) {
      recordingRef.current = null;
      rec.stopAndUnloadAsync().catch(() => {});
    }
    setIsRecording(false);
    setRecordingMs(0);
    setIsAtBottom(true);
    setNewMessageCount(0);
    setIsPeerTyping(false);
    isAtBottomRef.current = true;
    seenMessageIdsRef.current = new Set();
    if (peerTypingTimerRef.current) {
      clearTimeout(peerTypingTimerRef.current);
      peerTypingTimerRef.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    // Hydrate the persistent outbound queue first so that messages composed
    // before a network drop (or in a previous session) reappear immediately
    // as "queued", then flush them as soon as we attempt the GET below.
    void loadQueue(tripId).then((items) => {
      if (cancelled) return;
      queueRef.current = new Map(items.map((m) => [m.clientId, m]));
      if (items.length > 0) {
        const placeholders: ChatMessage[] = items.map((m) => ({
          id: m.clientId,
          clientId: m.clientId,
          tripId: m.tripId,
          senderId: userId,
          type: m.type,
          content: m.content,
          audioDurationMs: m.audioDurationMs ?? null,
          createdAt: m.createdAt,
          senderFirstName: "",
          senderLastName: "",
          status: "queued",
          _localUri: m.type === "text" ? undefined : m.content,
          _contentType: m.contentType,
          _fileName: m.fileName,
          _fileSize: m.fileSize,
        }));
        setMessages((prev) => {
          const seen = new Set(prev.map((p) => p.clientId).filter(Boolean) as string[]);
          const additions = placeholders.filter((p) => !seen.has(p.clientId!));
          return additions.length > 0 ? [...prev, ...additions] : prev;
        });
        flushQueue();
      }
    });

    api<{ messages: ChatMessage[] }>(`/trips/${tripId}/messages`)
      .then(({ messages: loaded }) => {
        if (!cancelled) {
          seenMessageIdsRef.current = new Set(loaded.map((m) => m.id));
          setMessages((prev) => {
            // Carry forward any locally-queued placeholders, but drop any
            // whose clientId is already echoed in the server-loaded list to
            // avoid showing a duplicate.
            const loadedClientIds = new Set(
              loaded.map((m) => m.clientId).filter(Boolean) as string[],
            );
            const queued = prev.filter(
              (m) =>
                m.clientId &&
                queueRef.current.has(m.clientId) &&
                !loadedClientIds.has(m.clientId),
            );
            return [...loaded, ...queued];
          });
          setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100);
          void markRead();
        }
      })
      .catch(() => {});

    const handleMessage = (msg: ChatMessage) => {
      if (cancelled || msg.tripId !== tripId) return;
      addMessage(msg);
      if (msg.senderId !== userId) {
        const s = getSocket();
        s?.emit("chat:message:delivered", { tripId, messageIds: [msg.id] });
      }
    };
    const handleRead = (p: { tripId: string; messageIds: string[]; readAt: string }) => {
      if (cancelled || p.tripId !== tripId) return;
      applyReadReceipt(p.messageIds, p.readAt);
    };
    const handleDelivered = (p: { tripId: string; messageIds: string[]; deliveredAt: string }) => {
      if (cancelled || p.tripId !== tripId) return;
      applyDeliveredReceipt(p.messageIds, p.deliveredAt);
    };
    const handleTypingStart = (p: { tripId: string; userId: string }) => {
      if (cancelled || p.tripId !== tripId || p.userId === userId) return;
      setIsPeerTyping(true);
      if (peerTypingTimerRef.current) clearTimeout(peerTypingTimerRef.current);
      peerTypingTimerRef.current = setTimeout(() => {
        setIsPeerTyping(false);
      }, TYPING_TIMEOUT_MS);
    };
    const handleTypingStop = (p: { tripId: string; userId: string }) => {
      if (cancelled || p.tripId !== tripId || p.userId === userId) return;
      if (peerTypingTimerRef.current) {
        clearTimeout(peerTypingTimerRef.current);
        peerTypingTimerRef.current = null;
      }
      setIsPeerTyping(false);
    };
    foregroundHandlerRef.current = handleMessage;
    readHandlerRef.current = handleRead;
    deliveredHandlerRef.current = handleDelivered;
    typingStartHandlerRef.current = handleTypingStart;
    typingStopHandlerRef.current = handleTypingStop;

    const joinRoom = (s: ReturnType<typeof getSocket>) => {
      if (!s) return;
      s.emit("ride:join", tripId);
      s.emit("chat:join", tripId);
      s.on("trip:message", handleMessage);
      s.on("chat:message:read", handleRead);
      s.on("chat:message:delivered", handleDelivered);
      s.on("chat:typing:start", handleTypingStart);
      s.on("chat:typing:stop", handleTypingStop);
    };

    const sock = getSocket();
    if (sock) {
      joinRoom(sock);
    } else {
      connectSocket().then((s) => {
        if (!cancelled) joinRoom(s);
      });
    }

    return () => {
      cancelled = true;
      foregroundHandlerRef.current = null;
      readHandlerRef.current = null;
      deliveredHandlerRef.current = null;
      typingStartHandlerRef.current = null;
      typingStopHandlerRef.current = null;
      const s = getSocket();
      if (s) {
        s.emit("chat:leave", tripId);
        s.off("trip:message", handleMessage);
        s.off("chat:message:read", handleRead);
        s.off("chat:message:delivered", handleDelivered);
        s.off("chat:typing:start", handleTypingStart);
        s.off("chat:typing:stop", handleTypingStop);
      }
    };
  }, [isOpen, tripId, userId, addMessage, applyReadReceipt, applyDeliveredReceipt, markRead, flushQueue]);

  useEffect(() => {
    if (!isOpen) return;
    const handleAppState = (next: AppStateStatus) => {
      const s = getSocket();
      if (next === "active") {
        if (s) {
          s.emit("chat:join", tripId);
          void markRead();
        }
        // Coming back to the foreground is the strongest signal that
        // connectivity may be restored, so flush the outbound queue.
        flushQueue();
      } else if (next === "background" || next === "inactive") {
        if (s) s.emit("chat:leave", tripId);
      }
    };
    const sub = AppState.addEventListener("change", handleAppState);
    return () => sub.remove();
  }, [isOpen, tripId, markRead, flushQueue]);

  // Whenever the socket reconnects (driven by AppContext), eagerly flush the
  // outbound queue so we don't have to wait for the next backoff tick.
  useEffect(() => {
    if (reconnectKey === 0 || !isOpen) return;
    flushQueue();
  }, [reconnectKey, isOpen, flushQueue]);

  // Keep retry timers running for the lifetime of the trip-chat component
  // (i.e. as long as the trip is active) so queued messages keep flushing in
  // the background even when the sheet is closed. Only clear on full unmount
  // — typically when the trip ends and the parent unmounts the sheet.
  useEffect(() => {
    return () => {
      for (const t of retryTimersRef.current.values()) clearTimeout(t);
      retryTimersRef.current.clear();
    };
  }, []);

  // If the active tripId changes (we transition to a different trip), clear
  // timers from the previous trip so we don't leak retries across trips.
  useEffect(() => {
    return () => {
      for (const t of retryTimersRef.current.values()) clearTimeout(t);
      retryTimersRef.current.clear();
      queueRef.current.clear();
    };
  }, [tripId]);

  useEffect(() => {
    if (reconnectKey === 0 || !isOpen) return;

    const sock = getSocket();
    if (!sock) return;

    if (foregroundHandlerRef.current) sock.off("trip:message", foregroundHandlerRef.current);
    if (readHandlerRef.current) sock.off("chat:message:read", readHandlerRef.current);
    if (deliveredHandlerRef.current) sock.off("chat:message:delivered", deliveredHandlerRef.current);
    if (typingStartHandlerRef.current) sock.off("chat:typing:start", typingStartHandlerRef.current);
    if (typingStopHandlerRef.current) sock.off("chat:typing:stop", typingStopHandlerRef.current);

    const handleMessage = (msg: ChatMessage) => {
      if (msg.tripId !== tripId) return;
      addMessage(msg);
      if (msg.senderId !== userId) {
        sock.emit("chat:message:delivered", { tripId, messageIds: [msg.id] });
      }
    };
    const handleRead = (p: { tripId: string; messageIds: string[]; readAt: string }) => {
      if (p.tripId !== tripId) return;
      applyReadReceipt(p.messageIds, p.readAt);
    };
    const handleDelivered = (p: { tripId: string; messageIds: string[]; deliveredAt: string }) => {
      if (p.tripId !== tripId) return;
      applyDeliveredReceipt(p.messageIds, p.deliveredAt);
    };
    const handleTypingStart = (p: { tripId: string; userId: string }) => {
      if (p.tripId !== tripId || p.userId === userId) return;
      setIsPeerTyping(true);
      if (peerTypingTimerRef.current) clearTimeout(peerTypingTimerRef.current);
      peerTypingTimerRef.current = setTimeout(() => setIsPeerTyping(false), TYPING_TIMEOUT_MS);
    };
    const handleTypingStop = (p: { tripId: string; userId: string }) => {
      if (p.tripId !== tripId || p.userId === userId) return;
      if (peerTypingTimerRef.current) {
        clearTimeout(peerTypingTimerRef.current);
        peerTypingTimerRef.current = null;
      }
      setIsPeerTyping(false);
    };
    foregroundHandlerRef.current = handleMessage;
    readHandlerRef.current = handleRead;
    deliveredHandlerRef.current = handleDelivered;
    typingStartHandlerRef.current = handleTypingStart;
    typingStopHandlerRef.current = handleTypingStop;

    sock.emit("ride:join", tripId);
    sock.emit("chat:join", tripId);
    sock.on("trip:message", handleMessage);
    sock.on("chat:message:read", handleRead);
    sock.on("chat:message:delivered", handleDelivered);
    sock.on("chat:typing:start", handleTypingStart);
    sock.on("chat:typing:stop", handleTypingStop);

    api<{ messages: ChatMessage[] }>(`/trips/${tripId}/messages`)
      .then(({ messages: loaded }) => {
        loaded.forEach(addMessage);
        void markRead();
      })
      .catch(() => {});

    return () => {
      foregroundHandlerRef.current = null;
      readHandlerRef.current = null;
      deliveredHandlerRef.current = null;
      typingStartHandlerRef.current = null;
      typingStopHandlerRef.current = null;
      sock.off("trip:message", handleMessage);
      sock.off("chat:message:read", handleRead);
      sock.off("chat:message:delivered", handleDelivered);
      sock.off("chat:typing:start", handleTypingStart);
      sock.off("chat:typing:stop", handleTypingStop);
    };
  }, [reconnectKey, isOpen, tripId, userId, addMessage, applyReadReceipt, applyDeliveredReceipt, markRead]);

  /**
   * Emit chat:typing:start (throttled to TYPING_THROTTLE_MS) or
   * chat:typing:stop. Server further debounces starts to drop floods.
   */
  const emitTyping = useCallback(
    (typing: boolean) => {
      const sock = getSocket();
      if (!sock) return;
      const now = Date.now();
      if (typing) {
        if (now - lastTypingSentAtRef.current < TYPING_THROTTLE_MS) return;
        lastTypingSentAtRef.current = now;
        sock.emit("chat:typing:start", { tripId });
      } else {
        if (lastTypingSentAtRef.current === 0) return;
        lastTypingSentAtRef.current = 0;
        sock.emit("chat:typing:stop", { tripId });
      }
    },
    [tripId],
  );

  const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeText = useCallback(
    (val: string) => {
      setText(val);
      if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
      if (val.length > 0) {
        emitTyping(true);
        typingIdleTimerRef.current = setTimeout(() => emitTyping(false), 2000);
      } else {
        emitTyping(false);
      }
    },
    [emitTyping],
  );
  useEffect(
    () => () => {
      if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
    },
    [],
  );

  /**
   * Optimistic text send with retry. The placeholder is appended immediately
   * with status "sending" and reconciled on the server echo (matched by
   * clientId) or marked "failed" if the request errors.
   */
  const sendTextWith = useCallback(
    async (content: string, retryClientId?: string) => {
      const clientId = retryClientId ?? makeClientId();
      const existing = queueRef.current.get(clientId);
      const createdAt = existing?.createdAt ?? new Date().toISOString();
      const queued: QueuedMessage = {
        clientId,
        tripId,
        type: "text",
        content,
        createdAt,
        attempts: existing?.attempts ?? 0,
      };
      queueRef.current.set(clientId, queued);
      void persistQueue();

      const placeholder: ChatMessage = {
        id: clientId,
        clientId,
        tripId,
        senderId: userId,
        type: "text",
        content,
        createdAt,
        senderFirstName: "",
        senderLastName: "",
        status: "sending",
      };
      setMessages((prev) => {
        if (prev.some((m) => m.clientId === clientId)) {
          return prev.map((m) => (m.clientId === clientId ? { ...m, ...placeholder } : m));
        }
        return [...prev, placeholder];
      });
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);

      try {
        const { message } = await api<{ message: ChatMessage }>(`/trips/${tripId}/messages`, {
          method: "POST",
          json: { type: "text", content, clientId },
        });
        removeFromQueue(clientId);
        addMessage({ ...message, clientId, status: "sent" });
      } catch (err) {
        // Only surface the rate-limit alert on the very first attempt so
        // that automatic background retries don't spam the user.
        if (queued.attempts === 0 && err instanceof ApiError && err.status === 429) {
          Alert.alert(t("tripChat.rateLimited"), t("tripChat.slowDown"));
        }
        handleSendError(queued, err);
      }
    },
    [tripId, userId, addMessage, t, persistQueue, removeFromQueue, handleSendError],
  );
  useEffect(() => {
    sendTextRef.current = (content: string, retryClientId?: string) => {
      void sendTextWith(content, retryClientId);
    };
  }, [sendTextWith]);

  const sendText = async () => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    setText("");
    emitTyping(false);
    setIsSending(true);
    try {
      await sendTextWith(trimmed);
    } finally {
      setIsSending(false);
    }
  };

  const sendQuickReply = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      void sendTextWith(trimmed);
    },
    [sendTextWith],
  );

  const [quickReplies, setQuickReplies] = useState<string[]>(() => getDefaultQuickReplies(role));
  const showQuickReplies = !isRecording && text.length === 0;

  // Load the user's customised quick replies when the sheet opens (and refresh
  // every time it is reopened so edits made in the settings screen show up
  // immediately in the chat strip).
  useEffect(() => {
    if (!isOpen || !userId) return;
    let cancelled = false;
    loadQuickReplies(userId, role)
      .then((list) => {
        if (!cancelled) setQuickReplies(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen, userId, role]);

  const sendImageWith = useCallback(
    async (
      localUri: string,
      contentType: string,
      name: string,
      size: number,
      retryClientId?: string,
    ) => {
      const clientId = retryClientId ?? makeClientId();
      const existing = queueRef.current.get(clientId);
      const createdAt = existing?.createdAt ?? new Date().toISOString();
      const queued: QueuedMessage = {
        clientId,
        tripId,
        type: "image",
        content: localUri,
        contentType,
        fileName: name,
        fileSize: size,
        createdAt,
        attempts: existing?.attempts ?? 0,
      };
      queueRef.current.set(clientId, queued);
      void persistQueue();

      const placeholder: ChatMessage = {
        id: clientId,
        clientId,
        tripId,
        senderId: userId,
        type: "image",
        content: localUri,
        createdAt,
        senderFirstName: "",
        senderLastName: "",
        status: "sending",
        uploadProgress: 0,
        _localUri: localUri,
        _contentType: contentType,
        _fileName: name,
        _fileSize: size,
      };
      setMessages((prev) => {
        if (prev.some((m) => m.clientId === clientId)) {
          return prev.map((m) => (m.clientId === clientId ? { ...m, ...placeholder } : m));
        }
        return [...prev, placeholder];
      });
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);

      const setProgress = (frac: number) => {
        setMessages((prev) =>
          prev.map((m) => (m.clientId === clientId ? { ...m, uploadProgress: Math.min(0.99, frac) } : m)),
        );
      };
      try {
        const { uploadURL, objectPath } = await requestChatUploadUrl(tripId, contentType, size, name);
        await uploadToPresignedUrl(uploadURL, localUri, contentType, setProgress);
        const { objectPath: finalPath } = await finalizeChatUpload(tripId, objectPath);
        const { message } = await api<{ message: ChatMessage }>(`/trips/${tripId}/messages`, {
          method: "POST",
          json: { type: "image", content: finalPath, clientId },
        });
        removeFromQueue(clientId);
        addMessage({ ...message, clientId, status: "sent" });
      } catch (err) {
        if (queued.attempts === 0 && err instanceof ApiError && err.status === 429) {
          Alert.alert(t("tripChat.rateLimited"), t("tripChat.slowDown"));
        }
        handleSendError(queued, err);
      }
    },
    [tripId, userId, addMessage, t, persistQueue, removeFromQueue, handleSendError],
  );
  useEffect(() => {
    sendImageRef.current = (
      localUri: string,
      contentType: string,
      name: string,
      size: number,
      retryClientId?: string,
    ) => {
      void sendImageWith(localUri, contentType, name, size, retryClientId);
    };
  }, [sendImageWith]);

  const sendVoiceWith = useCallback(
    async (localUri: string, durationMs: number, retryClientId?: string) => {
      const clientId = retryClientId ?? makeClientId();
      const existing = queueRef.current.get(clientId);
      const createdAt = existing?.createdAt ?? new Date().toISOString();
      const queued: QueuedMessage = {
        clientId,
        tripId,
        type: "voice",
        content: localUri,
        contentType: "audio/m4a",
        audioDurationMs: durationMs,
        createdAt,
        attempts: existing?.attempts ?? 0,
      };
      queueRef.current.set(clientId, queued);
      void persistQueue();

      const placeholder: ChatMessage = {
        id: clientId,
        clientId,
        tripId,
        senderId: userId,
        type: "voice",
        content: localUri,
        audioDurationMs: durationMs,
        createdAt,
        senderFirstName: "",
        senderLastName: "",
        status: "sending",
        uploadProgress: 0,
        _localUri: localUri,
        _contentType: "audio/m4a",
      };
      setMessages((prev) => {
        if (prev.some((m) => m.clientId === clientId)) {
          return prev.map((m) => (m.clientId === clientId ? { ...m, ...placeholder } : m));
        }
        return [...prev, placeholder];
      });
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);

      const setProgress = (frac: number) => {
        setMessages((prev) =>
          prev.map((m) => (m.clientId === clientId ? { ...m, uploadProgress: Math.min(0.99, frac) } : m)),
        );
      };
      try {
        const audioBlob = await fetch(localUri).then((r) => r.blob());
        const name = `voice_${Date.now()}.m4a`;
        const { uploadURL, objectPath } = await requestChatUploadUrl(tripId, "audio/m4a", audioBlob.size, name);
        await uploadToPresignedUrl(uploadURL, audioBlob, "audio/m4a", setProgress);
        const { objectPath: finalPath } = await finalizeChatUpload(tripId, objectPath);
        const { message } = await api<{ message: ChatMessage }>(`/trips/${tripId}/messages`, {
          method: "POST",
          json: {
            type: "voice",
            content: finalPath,
            audioDurationMs: Math.max(1, durationMs),
            clientId,
          },
        });
        removeFromQueue(clientId);
        addMessage({ ...message, clientId, status: "sent" });
      } catch (err) {
        if (queued.attempts === 0 && err instanceof ApiError && err.status === 429) {
          Alert.alert(t("tripChat.rateLimited"), t("tripChat.slowDown"));
        }
        handleSendError(queued, err);
      }
    },
    [tripId, userId, addMessage, t, persistQueue, removeFromQueue, handleSendError],
  );
  useEffect(() => {
    sendVoiceRef.current = (localUri: string, durationMs: number, retryClientId?: string) => {
      void sendVoiceWith(localUri, durationMs, retryClientId);
    };
  }, [sendVoiceWith]);

  const retryMessage = useCallback(
    (msg: ChatMessage) => {
      if (!msg.clientId) return;
      if (msg.type === "text") {
        void sendTextWith(msg.content, msg.clientId);
      } else if (msg.type === "image" && msg._localUri) {
        void sendImageWith(
          msg._localUri,
          msg._contentType ?? "image/jpeg",
          msg._fileName ?? "photo.jpg",
          msg._fileSize ?? 0,
          msg.clientId,
        );
      } else if (msg.type === "voice" && msg._localUri) {
        void sendVoiceWith(msg._localUri, msg.audioDurationMs ?? 0, msg.clientId);
      }
    },
    [sendTextWith, sendImageWith, sendVoiceWith],
  );

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t("tripChat.permissionRequired"), t("tripChat.galleryPermission"));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    void sendImageWith(
      asset.uri,
      asset.mimeType ?? "image/jpeg",
      asset.fileName ?? "photo.jpg",
      asset.fileSize ?? 1024 * 1024,
    );
  };

  const startRecording = async () => {
    if (isRecording) return;
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      recordingRef.current = recording;
      setIsRecording(true);
      setRecordingMs(0);
      recordTimerRef.current = setInterval(() => {
        setRecordingMs((prev) => prev + 200);
      }, 200);
    } catch {
      Alert.alert(t("tripChat.microphoneError"));
    }
  };

  const stopRecording = async () => {
    if (!isRecording || !recordingRef.current) return;
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    setIsRecording(false);
    const finalDurationMs = recordingMs;
    const recording = recordingRef.current;
    recordingRef.current = null;
    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recording.getURI();
      if (!uri) return;
      void sendVoiceWith(uri, finalDurationMs);
    } catch {
      Alert.alert(t("tripChat.microphoneError"));
    } finally {
      setRecordingMs(0);
    }
  };

  const handleVoicePress = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const renderItem = useMemo(
    () => ({ item }: { item: ChatMessage }) => (
      <MessageBubble
        message={item}
        isMine={item.senderId === userId}
        onRetry={retryMessage}
      />
    ),
    [userId, retryMessage],
  );

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardProvider>
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: c.background }]}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
      >
        {/* Header */}
        <View
          style={[
            styles.header,
            {
              backgroundColor: c.background,
              borderBottomColor: c.border,
              paddingTop: insets.top + 8,
            },
          ]}
        >
          <Pressable
            style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
            onPress={onClose}
          >
            <Feather name="chevron-down" size={24} color={c.foreground} />
          </Pressable>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={[styles.headerTitle, { color: c.foreground, fontFamily: fonts.bold }]}>
              {peerName}
            </Text>
            <Text style={[styles.headerSub, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
              {isPeerTyping ? t("tripChat.typing") : t("tripChat.tripChat")}
            </Text>
          </View>
          <View style={styles.backBtn} />
        </View>

        {/* Messages list */}
        <View style={styles.listWrapper}>
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id ?? item.clientId}
            style={styles.messageList}
            contentContainerStyle={[styles.listContent, { paddingBottom: 8 }]}
            renderItem={renderItem}
            automaticallyAdjustKeyboardInsets
            keyboardDismissMode="interactive"
            onScroll={handleScroll}
            scrollEventThrottle={100}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Feather name="message-circle" size={40} color={c.border} />
                <Text style={[styles.emptyText, { color: c.mutedForeground, fontFamily: fonts.medium }]}>
                  {t("tripChat.startConversation")}
                </Text>
              </View>
            }
            ListFooterComponent={
              isPeerTyping ? (
                <View style={styles.typingRow}>
                  <View style={[styles.typingBubble, { backgroundColor: c.surface }]}>
                    <Text style={[styles.typingDots, { color: c.mutedForeground }]}>
                      • • •
                    </Text>
                  </View>
                </View>
              ) : null
            }
          />
          {!isAtBottom && (
            <Pressable
              style={({ pressed }) => [
                styles.scrollToLatestBtn,
                { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 },
              ]}
              onPress={scrollToLatest}
            >
              <Feather name="chevron-down" size={18} color={c.primaryForeground} />
              {newMessageCount > 0 && (
                <View style={[styles.newMsgBadge, { backgroundColor: c.accent }]}>
                  <Text style={[styles.newMsgBadgeText, { color: c.accentForeground, fontFamily: fonts.bold }]}>
                    {newMessageCount > 99 ? "99+" : String(newMessageCount)}
                  </Text>
                </View>
              )}
            </Pressable>
          )}
        </View>

        {/* Recording indicator */}
        {isRecording && (
          <View style={[styles.recordingBar, { backgroundColor: c.accentSoft }]}>
            <View style={[styles.recordingDot, { backgroundColor: c.accent }]} />
            <Text style={[styles.recordingText, { color: c.accent, fontFamily: fonts.semiBold }]}>
              {t("tripChat.recording")} · {formatDuration(recordingMs)}
            </Text>
            <Text style={[styles.recordingHint, { color: c.accent, fontFamily: fonts.regular }]}>
              {t("tripChat.tapToStop")}
            </Text>
          </View>
        )}

        {/* Quick reply strip */}
        {showQuickReplies && (
          <View style={[styles.quickRepliesWrap, { borderTopColor: c.border }]}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickRepliesContent}
              keyboardShouldPersistTaps="handled"
            >
              {quickReplies.map((reply) => (
                <Pressable
                  key={reply}
                  onPress={() => sendQuickReply(reply)}
                  style={({ pressed }) => [
                    styles.quickReplyChip,
                    {
                      backgroundColor: c.surface,
                      borderColor: c.border,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={reply}
                >
                  <Text
                    style={[
                      styles.quickReplyText,
                      { color: c.foreground, fontFamily: fonts.medium },
                    ]}
                    numberOfLines={1}
                  >
                    {reply}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Input bar */}
        <View
          style={[
            styles.inputBar,
            {
              backgroundColor: c.background,
              borderTopColor: c.border,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <Pressable
            style={({ pressed }) => [
              styles.attachBtn,
              { backgroundColor: c.surface, opacity: pressed ? 0.6 : 1 },
            ]}
            onPress={pickImage}
            disabled={isRecording}
          >
            <Feather name="image" size={20} color={c.mutedForeground} />
          </Pressable>

          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: c.surface,
                color: c.foreground,
                fontFamily: fonts.regular,
                borderColor: c.border,
              },
            ]}
            placeholder={t("tripChat.placeholder")}
            placeholderTextColor={c.mutedForeground}
            value={text}
            onChangeText={onChangeText}
            multiline
            maxLength={1000}
            returnKeyType="send"
            onSubmitEditing={sendText}
            editable={!isRecording}
          />

          {text.trim().length > 0 ? (
            <Pressable
              style={({ pressed }) => [
                styles.sendBtn,
                { backgroundColor: c.primary, opacity: pressed || isSending ? 0.7 : 1 },
              ]}
              onPress={sendText}
              disabled={isSending}
            >
              {isSending ? (
                <ActivityIndicator size="small" color={c.primaryForeground} />
              ) : (
                <Feather name="send" size={18} color={c.primaryForeground} />
              )}
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [
                styles.sendBtn,
                {
                  backgroundColor: isRecording ? c.accent : c.surface,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
              onPress={handleVoicePress}
              disabled={false}
            >
              <Feather
                name={isRecording ? "square" : "mic"}
                size={18}
                color={isRecording ? c.accentForeground : c.mutedForeground}
              />
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
      </KeyboardProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listWrapper: { flex: 1, position: "relative" },
  messageList: { flex: 1 },
  scrollToLatestBtn: {
    position: "absolute",
    bottom: 12,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 4,
  },
  newMsgBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  newMsgBadgeText: { fontSize: 10, lineHeight: 14 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 16 },
  headerSub: { fontSize: 12, marginTop: 2 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    flexGrow: 1,
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    gap: 12,
  },
  emptyText: { fontSize: 14, textAlign: "center" },
  typingRow: {
    alignItems: "flex-start",
    paddingVertical: 4,
  },
  typingBubble: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  typingDots: { fontSize: 14, letterSpacing: 2 },
  recordingBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  recordingText: { fontSize: 14, flex: 1 },
  recordingHint: { fontSize: 12 },
  uploadingBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  uploadingText: { fontSize: 14 },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  attachBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  input: {
    flex: 1,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 100,
    lineHeight: 20,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  quickRepliesWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  quickRepliesContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  quickReplyChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 40,
    justifyContent: "center",
    marginEnd: 8,
  },
  quickReplyText: {
    fontSize: 14,
  },
});
