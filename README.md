# ArtisanMarket API

A RESTful backend API for **ArtisanMarket** — a multi-vendor e-commerce platform that connects artisan sellers with customers. Built with Node.js and Express, it provides everything needed to run a marketplace: authentication, product listings, order management, payments, vendor profiles, image uploads, and real-time notifications.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Running the Server](#running-the-server)
- [API Reference](#api-reference)
  - [Health & Status](#health--status)
  - [Authentication](#authentication)
  - [Products](#products)
  - [Orders](#orders)
  - [Vendors](#vendors)
  - [Customers](#customers)
  - [Payments](#payments)
  - [Vendor Bank Accounts](#vendor-bank-accounts)
  - [Uploads](#uploads)
  - [Admin](#admin)
- [Authentication Guide](#authentication-guide)
- [Real-Time Events (Socket.IO)](#real-time-events-socketio)
- [Security](#security)
- [License](#license)

---

## Features

- **Multi-role authentication** — customers, vendors, and admins with JWT
- **Product management** — create, update, soft-delete, search, and filter listings
- **Order lifecycle** — place orders, track status, cancel, add shipping details
- **Vendor dashboard** — store profiles, stats, order views, and delivery proofs
- **Payment processing** — Stripe payment intents and webhooks
- **Bank account linking** — Plaid integration for ACH payouts to vendors
- **Image uploads** — ImageKit CDN for product images and avatars
- **Real-time notifications** — Socket.IO for live order and product updates
- **Caching** — Redis-backed response caching for performance
- **Admin panel** — manage orders, vendors, and review delivery proofs

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ES Modules) |
| Framework | Express 4 |
| Database | MongoDB (Mongoose) |
| Cache | Redis |
| Payments | Stripe, Plaid |
| Image Storage | ImageKit |
| Real-time | Socket.IO |
| Auth | JSON Web Tokens (JWT) |
| Security | Helmet, CORS, express-rate-limit |

---

## Prerequisites

- **Node.js** v18 or higher
- **MongoDB** (local or Atlas)
- **Redis** (optional — the server starts without it but caching is disabled)
- A **Stripe** account (test keys work out of the box)
- A **Plaid** account (sandbox keys work for development)
- An **ImageKit** account for image uploads

---

## Installation

```bash
# Clone the repository
git clone https://github.com/ImmanuelN/artisanmarket-api.git
cd artisanmarket-api

# Install dependencies
npm install

# Copy the example environment file and fill in your values
cp .env.example .env
```

---

## Environment Variables

Create a `.env` file in the project root. The `.env.example` file contains all supported variables:

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Yes | `development` or `production` |
| `PORT` | No | Server port (default: `5000`) |
| `MONGODB_URI` | Yes | MongoDB connection string |
| `REDIS_URL` | No | Redis connection string — caching is skipped if omitted |
| `JWT_SECRET` | Yes | Secret key for signing JWT tokens |
| `JWT_EXPIRE` | No | Token expiry (default: `30d`) |
| `EMAIL_SERVICE` | No | Email provider (e.g. `gmail`) |
| `EMAIL_USER` | No | Sender email address |
| `EMAIL_PASS` | No | Email app password |
| `PLAID_CLIENT_ID` | No | Plaid client ID |
| `PLAID_SECRET` | No | Plaid secret key |
| `PLAID_ENV` | No | `sandbox`, `development`, or `production` (default: `sandbox`) |
| `STRIPE_SECRET_KEY` | No | Stripe secret key (`sk_test_…` or `sk_live_…`) |
| `STRIPE_PUBLISHABLE_KEY` | No | Stripe publishable key |
| `STRIPE_WEBHOOK_SECRET` | No | Stripe webhook signing secret |
| `IMAGEKIT_PUBLIC_KEY` | No | ImageKit public API key |
| `IMAGEKIT_PRIVATE_KEY` | No | ImageKit private API key |
| `IMAGEKIT_URL_ENDPOINT` | No | ImageKit URL endpoint |
| `CLIENT_URL` | No | Frontend URL for CORS (default: `http://localhost:5172`) |
| `CORS_ORIGINS` | No | Comma-separated list of additional allowed origins |
| `RATE_LIMIT_WINDOW_MS` | No | Rate-limit window in ms (default: `900000` = 15 min) |
| `RATE_LIMIT_MAX` | No | Max requests per window per IP (default: `100`) |
| `BCRYPT_SALT_ROUNDS` | No | bcrypt rounds (default: `12`) |
| `DEFAULT_COMMISSION_RATE` | No | Platform commission (default: `0.15`) |
| `KEEP_ALIVE_INTERVAL_HOURS` | No | Keep-alive ping interval in hours (default: `2`) |

---

## Running the Server

```bash
# Development (with auto-reload via nodemon)
npm run dev

# Production
npm start

# Development + monitoring server side-by-side
npm run dev:monitor
```

The server starts on the port defined by `PORT` (default `5000`).

```
🎉 ArtisanMarket Server Started Successfully!
🚀 Server running on port 5000
📊 Health check: http://localhost:5000/health
🔗 API Base URL: http://localhost:5000/api
```

---

## API Reference

All API endpoints are prefixed with `/api`. Protected routes require a `Bearer` token in the `Authorization` header.

### Health & Status

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/health` | No | Detailed server health (DB, services, memory) |
| GET | `/ping` | No | Simple liveness check |
| GET | `/api/keep-alive/status` | No | Keep-alive service status |
| POST | `/api/keep-alive/trigger` | No | Manually trigger a keep-alive ping |

**`GET /health` response:**
```json
{
  "status": "OK",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "environment": "development",
  "memory": { "used": 45, "total": 64, "external": 3 },
  "database": { "mongodb": "connected" },
  "services": { "plaid": "✅ Connected", "stripe": "✅ Connected" }
}
```

---

### Authentication

Base path: `/api/auth`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | No | Register a new user |
| POST | `/api/auth/login` | No | Login and receive a JWT |
| GET | `/api/auth/me` | Yes | Get the authenticated user's profile |

**Register — `POST /api/auth/register`**
```json
{
  "name": "Jane Smith",
  "email": "jane@example.com",
  "password": "password123",
  "role": "customer"
}
```
`role` is optional and can be `"customer"` (default) or `"vendor"`. Registering as a vendor automatically creates an empty vendor profile.

**Login — `POST /api/auth/login`**
```json
{
  "email": "jane@example.com",
  "password": "password123"
}
```

**Response (register / login):**
```json
{
  "success": true,
  "token": "<jwt>",
  "user": {
    "id": "64a1b...",
    "name": "Jane Smith",
    "email": "jane@example.com",
    "role": "customer",
    "onboardingComplete": false
  }
}
```

---

### Products

Base path: `/api/products`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/products` | No | List products with filtering, search & pagination |
| GET | `/api/products/featured/list` | No | Get featured products |
| GET | `/api/products/categories/list` | No | List all active categories |
| GET | `/api/products/search/combined` | No | Search products and vendor stores together |
| GET | `/api/products/:id` | No | Get a single product by ID |
| POST | `/api/products` | Vendor | Create a new product |
| PUT | `/api/products/:id` | Vendor | Update a product |
| PATCH | `/api/products/:id/status` | Vendor | Set product status (`active` / `inactive`) |
| DELETE | `/api/products/:id` | Vendor | Soft-delete a product |

**Query parameters for `GET /api/products`:**

| Parameter | Type | Description |
|---|---|---|
| `page` | number | Page number (default: `1`) |
| `limit` | number | Results per page (default: `12`) |
| `category` | string | Filter by category slug |
| `search` | string | Full-text search (title, description, tags, store name) |
| `minPrice` | number | Minimum price filter |
| `maxPrice` | number | Maximum price filter |
| `sortBy` | string | Sort field (default: `createdAt`) |
| `sortOrder` | string | `asc` or `desc` (default: `desc`) |
| `featured` | boolean | Return only featured products |
| `vendor` | string | Filter by vendor ID |

**Create product — `POST /api/products`**
```json
{
  "title": "Hand-woven Basket",
  "description": "Traditionally crafted rattan basket",
  "price": 45.00,
  "categories": ["Home Decor", "Handmade"],
  "tags": ["rattan", "basket", "artisan"],
  "images": ["https://cdn.imagekit.io/..."],
  "inventory": { "quantity": 20 }
}
```

---

### Orders

Base path: `/api/orders`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/orders` | Customer | List the current customer's orders |
| GET | `/api/orders/vendor/orders` | Vendor | List orders containing the vendor's products |
| GET | `/api/orders/:id` | Customer | Get a specific order |
| POST | `/api/orders` | Customer | Place a new order |
| PATCH | `/api/orders/:id/status` | Vendor / Admin | Update order status |
| PATCH | `/api/orders/:id/tracking` | Vendor / Admin | Add tracking information |
| PATCH | `/api/orders/:id/cancel` | Customer | Cancel a pending order |

**Order statuses:** `pending` → `processing` → `shipped` → `delivered` / `cancelled`

**Create order — `POST /api/orders`**
```json
{
  "items": [
    { "productId": "64a1b...", "quantity": 2 }
  ],
  "shippingAddress": {
    "firstName": "Jane",
    "lastName": "Smith",
    "address": "123 Main St",
    "city": "New York",
    "state": "NY",
    "zipCode": "10001",
    "country": "US"
  },
  "paymentMethod": "stripe",
  "subtotal": 90.00,
  "shippingCost": 5.00,
  "tax": 7.65,
  "total": 102.65
}
```

---

### Vendors

Base path: `/api/vendors`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/vendors/profile` | Vendor | Get the authenticated vendor's profile |
| PUT | `/api/vendors/profile` | Vendor | Create or update vendor profile |
| POST | `/api/vendors/complete-onboarding` | Vendor | Mark vendor onboarding as complete |
| GET | `/api/vendors/stats` | Vendor | Revenue, order counts, and active products |
| GET | `/api/vendors/orders` | Vendor | Get orders for the vendor |
| POST | `/api/vendors/orders/:orderId/delivery-proof` | Vendor | Upload arrival/delivery proof image |
| GET | `/api/vendors/delivery-proofs` | Vendor | List all delivery proofs for the vendor |
| GET | `/api/vendors/public/:vendorId` | No | Get a vendor's public profile |

**Update vendor profile — `PUT /api/vendors/profile`**
```json
{
  "storeName": "Basket Collective",
  "slogan": "Handmade with love",
  "storeDescription": "We craft traditional baskets...",
  "logo": "https://cdn.imagekit.io/...",
  "contact": {
    "phone": "+1-555-0100",
    "website": "https://basketcollective.com"
  },
  "business": {
    "address": { "city": "Austin" }
  }
}
```

---

### Customers

Base path: `/api/customers`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/customers/profile` | Customer | Get customer profile |
| PUT | `/api/customers/profile` | Customer | Update name, email, or phone |
| PUT | `/api/customers/password` | Customer | Change password |
| PUT | `/api/customers/avatar` | Customer | Update avatar URL |
| GET | `/api/customers/stats` | Customer | Total orders, spending, and wishlist count |
| GET | `/api/customers/preferences` | Customer | Get notification and display preferences |
| PUT | `/api/customers/preferences` | Customer | Update preferences |
| GET | `/api/customers/shipping-addresses` | Customer | List saved shipping addresses |
| POST | `/api/customers/shipping-addresses` | Customer | Add a shipping address |
| PUT | `/api/customers/shipping-addresses/:id` | Customer | Update a shipping address |
| DELETE | `/api/customers/shipping-addresses/:id` | Customer | Delete a shipping address |

---

### Payments

Base path: `/api/payments`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/payments/create-payment-intent` | Yes | Create a Stripe PaymentIntent |
| POST | `/api/payments/create-link-token` | Yes | Create a Plaid Link token |
| POST | `/api/payments/exchange-token` | Yes | Exchange a Plaid public token for an access token |
| POST | `/api/payments/get-accounts` | Yes | Retrieve bank accounts via Plaid |
| POST | `/api/payments/create-transfer` | Yes | Initiate an ACH transfer via Plaid |
| GET | `/api/payments/payment-methods/:customerId` | Yes | List Stripe payment methods for a customer |
| POST | `/api/payments/create-customer` | Yes | Create a Stripe customer |
| POST | `/api/payments/webhook` | No | Stripe webhook handler |

**Create payment intent — `POST /api/payments/create-payment-intent`**
```json
{
  "amount": 102.65,
  "currency": "usd",
  "metadata": { "orderId": "64a1b..." }
}
```

---

### Vendor Bank Accounts

Base path: `/api/vendor-bank`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/vendor-bank/create-link-token` | Vendor | Generate a Plaid Link token for bank setup |
| POST | `/api/vendor-bank/setup-bank-account` | Vendor | Link a bank account via Plaid public token |
| GET | `/api/vendor-bank/bank-account` | Vendor | Get connected bank account info |
| POST | `/api/vendor-bank/simulate-payout` | Vendor | Simulate a payout (sandbox only) |
| GET | `/api/vendor-bank/financial-summary` | Vendor | Balance, earnings, and payout method |

See [`VENDOR_BANK_SETUP_GUIDE.md`](./VENDOR_BANK_SETUP_GUIDE.md) for a full integration walkthrough.

---

### Uploads

Base path: `/api/upload`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/upload/imagekit-auth` | No | Get ImageKit authentication parameters |
| POST | `/api/upload/image` | Yes | Upload a product image (form-data, field: `image`) |
| POST | `/api/upload/avatar` | Yes | Upload a user avatar (form-data, field: `avatar`) |

Images are stored in ImageKit and the response returns the CDN URL:
```json
{ "success": true, "url": "https://ik.imagekit.io/..." }
```

---

### Admin

Base path: `/api/admin` — **Admin role required**

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/admin/dashboard` | Admin | Platform-wide stats |
| GET | `/api/admin/orders` | Admin | List all orders with filters |
| PATCH | `/api/admin/orders/:orderId/status` | Admin | Update any order's status |
| POST | `/api/admin/orders/:orderId/release-escrow` | Admin | Manually release held escrow |
| GET | `/api/admin/arrival-proofs` | Admin | List delivery proofs for review |
| PATCH | `/api/admin/arrival-proofs/:proofId/review` | Admin | Approve, reject, or flag a proof |
| GET | `/api/admin/vendors` | Admin | List all vendor profiles |

**Review arrival proof — `PATCH /api/admin/arrival-proofs/:proofId/review`**
```json
{
  "action": "approve",
  "adminNotes": "Proof verified — goods delivered in good condition."
}
```
`action` can be `"approve"`, `"reject"`, or `"requires_review"`.

---

## Authentication Guide

All protected endpoints require a JWT in the `Authorization` header:

```
Authorization: Bearer <token>
```

Tokens are returned from `/api/auth/register` and `/api/auth/login`. The default token lifetime is **30 days** (configurable via `JWT_EXPIRE`).

**User roles:**
- `customer` — can browse products, place and manage their own orders
- `vendor` — can manage products, view their orders, and configure payouts
- `admin` — full access to all admin endpoints

---

## Real-Time Events (Socket.IO)

The server exposes a Socket.IO endpoint on the same port as the HTTP server.

### Client → Server events

| Event | Payload | Description |
|---|---|---|
| `join-vendor-room` | `vendorId: string` | Subscribe to real-time updates for a vendor |
| `order-update` | `{ vendorId, ...orderData }` | Push an order update to a vendor's room |

### Server → Client events

| Event | Payload | Description |
|---|---|---|
| `new-order` | Order object | Fired when a new order arrives for a vendor |
| `products-updated` | Products array | Fired when a vendor's product list changes |

**Example (browser client):**
```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:5000');

socket.emit('join-vendor-room', vendorId);

socket.on('new-order', (order) => {
  console.log('New order received:', order);
});
```

---

## Security

- **Helmet** — sets secure HTTP headers
- **CORS** — restricted to allowed origins (`CLIENT_URL`, `CORS_ORIGINS`)
- **Rate limiting** — 100 requests per 15 minutes per IP on all `/api/*` routes
- **JWT authentication** — stateless token-based auth with configurable expiry
- **Password hashing** — bcrypt with configurable salt rounds
- **Input validation** — express-validator on all write endpoints
- **Stripe webhook verification** — request signatures validated before processing

---

## License

This project is licensed under the **MIT License**.

## Contact

For any inquiries, please contact:
- **Immanuel Nakale**: [nakaleimmanuel6@gmail.com](mailto:nakaleimmanuel6@gmail.com)
- **GitHub**: [ImmanuelN](https://github.com/ImmanuelN)
