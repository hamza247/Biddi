jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock("expo-secure-store", () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import { ApiError } from "./api";
import { isTransientSendError, nextBackoffMs } from "./chatQueue";

describe("chatQueue.nextBackoffMs", () => {
  beforeEach(() => {
    // Force jitter to its midpoint so the math is deterministic.
    jest.spyOn(Math, "random").mockReturnValue(0.5);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("grows exponentially from 2s and caps at 30s", () => {
    // base = min(30000, 2000 * 2^(attempts-1)); jitter @ 0.5 => *1.0
    expect(nextBackoffMs(1)).toBe(2000);
    expect(nextBackoffMs(2)).toBe(4000);
    expect(nextBackoffMs(3)).toBe(8000);
    expect(nextBackoffMs(4)).toBe(16000);
    expect(nextBackoffMs(5)).toBe(30000);
    expect(nextBackoffMs(10)).toBe(30000);
  });

  it("treats attempts of 0 the same as 1 (first retry)", () => {
    expect(nextBackoffMs(0)).toBe(2000);
  });
});

describe("chatQueue.isTransientSendError", () => {
  it("retries network/unknown errors", () => {
    expect(isTransientSendError(new Error("Network request failed"))).toBe(true);
    expect(isTransientSendError(undefined)).toBe(true);
  });

  it("retries 429 and 5xx", () => {
    expect(isTransientSendError(new ApiError("rate", 429, null))).toBe(true);
    expect(isTransientSendError(new ApiError("oops", 500, null))).toBe(true);
    expect(isTransientSendError(new ApiError("gateway", 502, null))).toBe(true);
    expect(isTransientSendError(new ApiError("zero", 0, null))).toBe(true);
  });

  it("does not retry permanent 4xx errors", () => {
    expect(isTransientSendError(new ApiError("bad", 400, null))).toBe(false);
    expect(isTransientSendError(new ApiError("auth", 401, null))).toBe(false);
    expect(isTransientSendError(new ApiError("forbidden", 403, null))).toBe(false);
    expect(isTransientSendError(new ApiError("missing", 404, null))).toBe(false);
  });
});
