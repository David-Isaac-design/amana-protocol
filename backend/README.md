# 🌾 Amana Protocol Backend Service

The official Node.js/TypeScript backend for **Amana**, a decentralized escrow protocol designed to secure agricultural trade across different regions.

Amana eliminates the "Trust Gap" between buyers and sellers using Soroban Smart Contracts on the Stellar network, ensuring fair trade even when parties are hundreds of miles apart.

## About Amana

**Amana** provides a programmable safety net for regional commodity trading:

- **Smart Escrow**: Secure funds holding using cNGN/stablecoins on the Stellar network
- **Dynamic Loss Sharing**: Negotiable risk-sharing ratios (e.g., 50/50, 70/30) for handling transit accidents
- **Proof-of-Delivery (PoD)**: Mandatory video-based verification involving buyer and driver
- **Automated Settlement**: Flat 1% platform fee deducted upon successful trade completion
- **Path-payment quotes**: The wallet API returns read-only Stellar route quotes; it does not submit swaps or invoke escrow path-deposit methods.

## Backend Responsibilities

This service provides the API and infrastructure integration layer for the Amana escrow protocol.
It handles trade orchestration, Supabase metadata, IPFS/Pinata uploads, Stellar payment bridging, and OpenTelemetry tracing.

## Features

- Node.js + TypeScript backend service
- Express API server
- Prisma ORM for database access
- Supabase integration for off-chain metadata
- Pinata SDK for IPFS uploads
- Stellar SDK for transaction and wallet interactions
- OpenTelemetry tracing with Jaeger/Prometheus/Zipkin exporters
- Jest test suite for backend behavior

## Getting Started

### Prerequisites

- Node.js 20+ / npm
- Access to required environment variables
- Supabase database and/or Redis as required by your environment

### Install dependencies

```bash
cd backend
npm install
```

### Environment

Copy the example env files and configure your secrets:

```bash
cp .env.example .env
cp .env.tracing.example .env.tracing
```

### Run in development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Run production

```bash
npm run start
```

### Tests

```bash
npm test
```

### Admin Auth Regression Suite

A dedicated CI regression suite (`src/__tests__/admin.auth.ci-regression.test.ts`) covers
admin route authentication and authorization. It validates feature gating, JWT validation,
wallet allowlist enforcement, token revocation, and error response shape consistency.

Run it locally:

```bash
# Using pnpm
pnpm jest --config jest.config.js --forceExit --detectOpenHandles --testPathPatterns='admin\.auth\.ci-regression' --verbose

# Using npm
npx jest --config jest.config.js --forceExit --detectOpenHandles --testPathPatterns='admin\.auth\.ci-regression' --verbose
```

CI runs this suite as a separate named step (`Admin auth regression suite`) so any
regression in admin authentication causes CI to fail independently of the full test suite.

## Notes

- `prisma/` contains schema and seed logic for the backend database.
- `src/` contains the Express server, routes, middleware, services, and docs.
- `dist/` is the compiled output directory created by `npm run build`.

## Repository Scope

This backend service lives inside the `backend/` folder of the Amana monorepo and provides the API, database, and infrastructure integration for the project.
