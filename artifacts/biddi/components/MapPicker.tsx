import React, { useRef } from "react";
import { StyleSheet } from "react-native";
import MapView, { type Region } from "react-native-maps";

export interface MapPickerHandle {
  /** Animate the visible region to a new center point. */
  animateToCenter(lat: number, lng: number): void;
}

interface Props {
  initialLat: number;
  initialLng: number;
  /** Fired after the rider stops dragging the map. The given coordinates
   * correspond to the map's center, which is also where the overlay pin
   * sits in the parent screen. */
  onRegionChangeComplete: (lat: number, lng: number) => void;
  innerRef?: React.MutableRefObject<MapPickerHandle | null>;
}

/**
 * Native draggable map for the inDrive-style pin picker. Uses Google Maps
 * as the only tile provider (MapTiler was removed from the stack). Web has
 * its own stub (MapPicker.web.tsx).
 */
export function MapPicker({ initialLat, initialLng, onRegionChangeComplete, innerRef }: Props) {
  const ref = useRef<MapView | null>(null);

  React.useImperativeHandle(
    innerRef as React.RefObject<MapPickerHandle>,
    () => ({
      animateToCenter(lat, lng) {
        ref.current?.animateToRegion(
          {
            latitude: lat,
            longitude: lng,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          },
          400,
        );
      },
    }),
    [],
  );

  const handle = (region: Region) => {
    onRegionChangeComplete(region.latitude, region.longitude);
  };

  return (
    <MapView
      ref={ref}
      style={StyleSheet.absoluteFill}
      initialRegion={{
        latitude: initialLat,
        longitude: initialLng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }}
      showsUserLocation
      showsMyLocationButton={false}
      toolbarEnabled={false}
      onRegionChangeComplete={handle}
      mapType="standard"
    >
    </MapView>
  );
}
