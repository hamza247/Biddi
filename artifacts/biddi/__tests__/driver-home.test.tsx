/**
 * Smoke test for the driver home screen.
 *
 * Verifies that the screen mounts without throwing and that the two key
 * UI landmarks — the status card and the wallet chip — are rendered.
 */

import React from "react";
import { render, screen } from "@testing-library/react-native";

// ── Expo / React-Navigation stubs ────────────────────────────────────────────

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        "driverHome.driver": "Driver",
        "driverHome.online": "ONLINE",
        "driverHome.offline": "OFFLINE",
        "driverHome.receiving": "Receiving requests",
        "driverHome.tapToGoOnline": "Tap to go online",
        "driverHome.todayEarnings": `Today · $${vars?.amount ?? "0.00"} · ${vars?.count ?? 0} trips`,
        "driverHome.waitingForRequest": "Waiting for the next request",
        "driverHome.waitingSubtitle": "New ride requests will appear here.",
        "driverHome.youreOffline": "You're offline",
        "driverHome.offlineSubtitle": "Go online to start receiving rider bids.",
        "driverHome.walletBalance": "Wallet",
      };
      return map[key] ?? key;
    },
  }),
}));

// ── Expo location: never resolves during test run ─────────────────────────────

jest.mock("expo-location", () => ({
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: "denied" }),
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: "denied" }),
  getLastKnownPositionAsync: jest.fn().mockResolvedValue(null),
  getCurrentPositionAsync: jest.fn().mockReturnValue(new Promise(() => {})),
  watchPositionAsync: jest.fn().mockReturnValue(new Promise(() => {})),
  Accuracy: { Balanced: 3 },
}));

// ── Map component: lightweight placeholder so no native bridge is touched ─────

jest.mock("@/components/AppMap", () => {
  const { forwardRef } = require("react");
  return {
    AppMap: forwardRef((_props: unknown, _ref: unknown) => null),
  };
});

// ── Context hooks ─────────────────────────────────────────────────────────────

jest.mock("@/context/AppContext", () => ({
  useAuth: () => ({
    user: {
      firstName: "Alex",
      phone: "+10000000000",
      walletBalance: "42.50",
      driverStatus: "approved",
    },
  }),
  useDriver: () => ({
    earnings: [],
    earningsStale: false,
    driverOnline: false,
    driverIncoming: [],
    driverTrip: null,
    setDriverOnline: jest.fn(),
    declineDriverRequest: jest.fn(),
    placeDriverBid: jest.fn(),
  }),
}));

// ── Theming hooks ─────────────────────────────────────────────────────────────

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    primary: "#4f46e5",
    primarySoft: "#ede9fe",
    accent: "#f59e0b",
    foreground: "#111827",
    mutedForeground: "#6b7280",
    surface: "#ffffff",
    background: "#f9fafb",
    border: "#e5e7eb",
  }),
}));

jest.mock("@/hooks/useFontFamily", () => ({
  useFontFamily: () => ({
    regular: undefined,
    medium: undefined,
    semiBold: undefined,
    bold: undefined,
  }),
}));

// ── Config and API ────────────────────────────────────────────────────────────

jest.mock("@/lib/config", () => ({
  useConfig: () => ({ driverEtaLabelsEnabled: false }),
}));

jest.mock("@/lib/api", () => ({
  api: jest.fn().mockReturnValue(new Promise(() => {})),
}));

jest.mock("@/lib/storage", () => ({
  // Never resolve during the test — avoids async state updates that would
  // trigger React's act() warnings for an out-of-act setState call.
  getJSON: jest.fn().mockReturnValue(new Promise(() => {})),
  setJSON: jest.fn().mockReturnValue(new Promise(() => {})),
}));

// ── Vector icons ──────────────────────────────────────────────────────────────

jest.mock("@expo/vector-icons", () => {
  const { Text } = require("react-native");
  return {
    Feather: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

// ─────────────────────────────────────────────────────────────────────────────

import DriverHome from "../app/(driver)/home";

describe("DriverHome screen", () => {
  it("mounts without throwing", () => {
    expect(() => render(<DriverHome />)).not.toThrow();
  });

  it("renders the status card", () => {
    render(<DriverHome />);
    expect(screen.getByText("OFFLINE")).toBeTruthy();
    expect(screen.getByText("Tap to go online")).toBeTruthy();
  });

  it("renders the wallet chip", () => {
    render(<DriverHome />);
    expect(screen.getByText("Wallet")).toBeTruthy();
    expect(screen.getByText("$42.50")).toBeTruthy();
  });
});
