import { describe, expect, it } from "vitest";

import {
  alongTrackDistanceKm,
  crossTrackDistanceKm,
  rideMatchesDestination,
} from "./destinationMode";

const cfg = { matchRadiusKm: 2, corridorKm: 1 };

// Pickup ~ Times Square, Dropoff ~ Central Park north end (heading north).
const pickup = { lat: 40.758, lng: -73.9855 };
const dropoff = { lat: 40.8, lng: -73.958 };
const ride = {
  pickupLat: pickup.lat,
  pickupLng: pickup.lng,
  dropoffLat: dropoff.lat,
  dropoffLng: dropoff.lng,
};

describe("rideMatchesDestination", () => {
  it("matches when destination is near the dropoff (within radius)", () => {
    const dest = { destLat: 40.801, destLng: -73.957 };
    expect(rideMatchesDestination(ride, dest, cfg)).toBe(true);
  });

  it("matches a destination on-corridor and ahead of pickup", () => {
    const dest = { destLat: 40.78, destLng: -73.972 };
    expect(rideMatchesDestination(ride, dest, cfg)).toBe(true);
  });

  it("rejects a destination behind the pickup (opposite direction)", () => {
    const dest = { destLat: 40.74, destLng: -74.0 };
    expect(rideMatchesDestination(ride, dest, cfg)).toBe(false);
  });

  it("rejects a destination collinear but behind pickup", () => {
    const dLat = dropoff.lat - pickup.lat;
    const dLng = dropoff.lng - pickup.lng;
    const dest = {
      destLat: pickup.lat - dLat * 0.5,
      destLng: pickup.lng - dLng * 0.5,
    };
    expect(rideMatchesDestination(ride, dest, cfg)).toBe(false);
  });

  it("rejects a destination off-corridor", () => {
    const dest = { destLat: 40.78, destLng: -74.05 };
    expect(rideMatchesDestination(ride, dest, cfg)).toBe(false);
  });

  it("rejects when ride coords are missing", () => {
    expect(
      rideMatchesDestination(
        { pickupLat: null, pickupLng: null, dropoffLat: null, dropoffLng: null },
        { destLat: 40.78, destLng: -73.97 },
        cfg,
      ),
    ).toBe(false);
  });
});

describe("alongTrackDistanceKm", () => {
  it("is positive when point is ahead of A on the A→B path", () => {
    const at = alongTrackDistanceKm(
      pickup.lat,
      pickup.lng,
      dropoff.lat,
      dropoff.lng,
      40.78,
      -73.972,
    );
    expect(at).toBeGreaterThan(0);
  });

  it("is negative when point is behind A", () => {
    const dLat = dropoff.lat - pickup.lat;
    const dLng = dropoff.lng - pickup.lng;
    const at = alongTrackDistanceKm(
      pickup.lat,
      pickup.lng,
      dropoff.lat,
      dropoff.lng,
      pickup.lat - dLat * 0.5,
      pickup.lng - dLng * 0.5,
    );
    expect(at).toBeLessThan(0);
  });
});

describe("crossTrackDistanceKm", () => {
  it("is small for points near the line", () => {
    const xt = crossTrackDistanceKm(
      pickup.lat,
      pickup.lng,
      dropoff.lat,
      dropoff.lng,
      40.78,
      -73.972,
    );
    expect(xt).toBeLessThan(1);
  });

  it("is large for points far off the line", () => {
    const xt = crossTrackDistanceKm(
      pickup.lat,
      pickup.lng,
      dropoff.lat,
      dropoff.lng,
      40.78,
      -74.05,
    );
    expect(xt).toBeGreaterThan(2);
  });
});
