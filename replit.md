# Biddi

A reverse-auction ride-hailing app where riders post a trip, drivers bid, and the rider picks a bid.

## Run & Operate

- **Sync DB Schema**: `pnpm --filter @workspace/db run push`
- **Run API Server**: `pnpm --filter @workspace/api-server run dev`
- **Run Mobile App (Expo)**: `pnpm --filter @workspace/biddi run dev`
- **Run Admin Panel**: `pnpm --filter @workspace/admin run dev`
- **Required Env Vars**: `SESSION_SECRET` (production), `VITE_MAPTILER_KEY` (admin/API), `EXPO_PUBLIC_MAPTILER_KEY` (mobile), `VITE_GOOGLE_MAPS_API_KEY_WEB` (admin — env-var fallback if DB key is absent).

## Stack

- **Mobile**: Expo + React Native + Expo Router
- **Admin**: React + Vite + Tailwind + shadcn-ui + wouter
- **API**: Express + Socket.IO + JWT
- **Database**: PostgreSQL via Drizzle ORM
- **Build Tool**: Vite (for Admin and Mockup Sandbox), Expo (for Mobile)

## Where things live

- `artifacts/biddi`: Mobile app source
- `artifacts/admin`: Admin panel source
- `artifacts/api-server`: API server source
- `lib/db`: Database schema definition (Drizzle ORM)
- `artifacts/api-server/src/lib/sms.ts`: Twilio integration point
- `app.config.ts`: Expo app configuration
- `artifacts/biddi/lib/notificationSounds.ts`: Mobile notification sound player
- `artifacts/biddi/assets/flags/`: Country flag assets
- `components/TripChatSheet.tsx`: Trip chat UI component
- `app/(rider)/trip.tsx`: Rider trip screen
- `app/(driver)/trip.tsx`: Driver trip screen
- `artifacts/api-server/src/routes/rides.ts`: Ride sharing public endpoints

## Architecture decisions

- **Realtime Communication**: Uses Socket.IO for live updates (driver locations, ride status, chat messages) with JWT bearer token authentication.
- **Offline Country Flags**: Country flags are bundled as local PNGs to ensure the signup country picker works without network connectivity.
- **Ephemeral In-trip Chat**: Chat messages are scoped to the trip and not stored long-term after the trip ends to reduce data footprint and simplify privacy.
- **Flexible Map Provider Integration**: Supports multiple map providers (MapTiler, Google, OSM) with admin-configurable toggles per map feature (autocomplete, geocode, routing) and platform-specific API key handling.
- **Rate Limiting**: Critical endpoints like OTP requests, map API calls, and chat message sending are rate-limited per user/IP to prevent abuse.
- **Admin Map Stack (Leaflet 1.9.x)**: Admin map surfaces intentionally stay on Leaflet 1.9.x. The key plugins (`leaflet.markercluster`, `leaflet.heat`, `leaflet-draw`, `leaflet.gridlayer.googlemutant`) are not Leaflet 2.x-compatible; upgrading would break more than it fixes. `leaflet.gridlayer.googlemutant` is lazy-imported only when a Google Maps key is actively used — never on the OSM/MapTiler fallback path.
- **Admin Map Tile Fallback Order**: Google Maps (if `googleMapsApiKeyWeb` set in app_config) → MapTiler streets tiles (if `VITE_MAPTILER_KEY` set) → CARTO Voyager OSM tiles.

## Product

- **User Authentication**: Phone + OTP for riders/drivers, email + password for admins.
- **Realtime Ride Tracking**: Live driver location and ride status updates.
- **In-Trip Messaging**: Real-time chat between riders and drivers with rich media support (text, image, voice notes) and read receipts.
- **Admin Panel**: Comprehensive interface for managing users, drivers, rides, payments, analytics, and app configurations.
- **Driver Onboarding**: In-app flow for drivers to apply, submit documents, and manage vehicle information.
- **Trip Sharing**: Riders can share a live-tracking URL of their active trip with friends/family.

## User preferences

_Populate as you build_

## Gotchas

- **Production `SESSION_SECRET`**: Must be set in production for JWT security.
- **Twilio Integration**: Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`) needs to be connected for real SMS sending.
- **Admin Password**: Seeded admin password (`biddi-admin`) should be changed after initial setup.
- **Notification Sounds**: Custom OS push sounds require running `pnpm --filter biddi run sync-sounds` and an EAS rebuild to bundle natively.

## Pointers

- **Expo Dev Setup**: See `artifacts/biddi/DEV_SETUP.md` for detailed Expo development instructions.
- **FlagCDN**: Source for country flag PNGs (`flagcdn.com`).
- **MapTiler**: Geocoding and routing provider ([https://www.maptiler.com](https://www.maptiler.com)).
- **Nominatim**: OSM geocoding service ([https://nominatim.org/](https://nominatim.org/)).
- **OSRM**: OSM routing service ([http://project-osrm.org/](http://project-osrm.org/)).