# Yuna License Panel

A functional license/key-management dashboard inspired by the supplied screenshots.

## Features
- Secure random license-key generation
- Custom keys
- Game selector
- 1–36500 day durations
- Maximum-device limits
- Activation API with device binding
- Expiration enforcement
- Revoke / delete
- Reset bound devices
- SQLite persistence
- Responsive dark/purple UI

## Run
1. Install Node.js 18+.
2. In this folder run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000`.

## App activation API
POST `/api/activate` with JSON:
`{"key":"YUNA-ABC123-DEF456-789ABC","device_id":"unique-device-id"}`

The response tells the client whether the key is valid, its expiry, and device usage.

For production, put the API behind HTTPS and add real admin authentication/authorization before exposing the management endpoints.
