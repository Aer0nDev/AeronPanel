# Yuna License Panel — PostgreSQL Edition

A functional license/key-management dashboard inspired by the supplied screenshots.

## What's changed

This version uses **PostgreSQL instead of SQLite**, so license records are stored in a persistent database rather than Render's temporary local filesystem.

Features:
- Secure random license-key generation
- Custom keys
- Game selector
- 1–36500 day durations
- Maximum-device limits
- Activation API with device binding
- Transaction-safe device activation
- Expiration enforcement
- Revoke / delete
- Reset bound devices
- Event logging
- PostgreSQL persistence
- Responsive dark/purple UI

## Local setup

1. Install Node.js 18+ and PostgreSQL.
2. Create a PostgreSQL database.
3. Set `DATABASE_URL` to your PostgreSQL connection string.
4. Run `npm install`.
5. Run `npm start`.
6. Open `http://localhost:3000`.

Example environment variables:

```text
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
PORT=3000
```

If your PostgreSQL provider requires SSL, also set:

```text
DATABASE_SSL=true
```

The app automatically creates the required tables and indexes on first startup.

## Render deployment

Create a PostgreSQL database in Render and a **Web Service** for this repository.

For the Web Service use:

- Build Command: `npm install`
- Start Command: `npm start`
- Instance Type: `Free` (if available on your account)

In the Web Service's **Environment** settings, add `DATABASE_URL` using the PostgreSQL database's connection string. Prefer the database's internal connection string when the database and Web Service are in the same Render region.

Do not commit database passwords or `.env` files to GitHub.

## App activation API

POST `/api/activate` with JSON:

```json
{"key":"YUNA-ABC123-DEF456-789ABC","device_id":"unique-device-id"}
```

The response tells the client whether the key is valid, its expiry, and device usage.

For production, put the API behind HTTPS and add real admin authentication/authorization before exposing the management endpoints.
