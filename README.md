# Nivasa Backend API

A Node.js backend API built with **Express 5** and **TypeScript**, using **Prisma** as the ORM for PostgreSQL and **JWT** for authentication.

## Tech Stack

| Layer          | Technology                      |
| -------------- | ------------------------------- |
| Runtime        | Node.js                        |
| Language       | TypeScript                      |
| Framework      | Express 5                       |
| ORM            | Prisma                         |
| Database       | PostgreSQL                      |
| DB Migrations  | Liquibase (separate project)    |
| Authentication | JWT (jsonwebtoken + bcryptjs)   |
| Dev Tooling    | Nodemon, ts-node                |

## Architecture Overview

```
┌──────────────────────────────────────────────┐
│                 Client / UI                  │
└──────────────────┬───────────────────────────┘
                   │  HTTP
┌──────────────────▼───────────────────────────┐
│            Express (REST API)                │
│                                              │
│   Middleware → Routes → Controllers          │
│       │                      │               │
│       │         ┌────────────▼────────┐      │
│       │         │     Services        │      │
│       │         │  (Business Logic)   │      │
│       │         └────────────┬────────┘      │
│       │                      │               │
│       │         ┌────────────▼────────┐      │
│       │         │   Prisma ORM        │      │
│       │         │  (Query Layer)      │      │
│       │         └────────────┬────────┘      │
└──────────────────────────────┼───────────────┘
                               │
┌──────────────────────────────▼───────────────┐
│           PostgreSQL Database                │
│       (Schema managed by Liquibase)          │
└──────────────────────────────────────────────┘
```

> **Important:** Database schema migrations are managed by a **separate Liquibase project**. Prisma is used **only** as an ORM for type-safe queries — not for migrations. After applying Liquibase changesets, run `npm run db:pull` to sync Prisma's schema.

## Prerequisites

- **Node.js** ≥ 18
- **PostgreSQL** running and accessible
- **Liquibase** migrations applied to the target database

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Update `.env` with your database credentials and JWT secret:

```bash
PORT=3000
NODE_ENV=development
DATABASE_URL=postgres://user:password@localhost:5432/your_database

JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d

LOG_LEVEL=info
```

### 3. Sync Prisma with Database

After Liquibase migrations have been applied:

```bash
# Introspect the database and update prisma/schema.prisma
npm run db:pull

# Generate the Prisma Client based on the schema
npm run db:generate
```

### 4. Start Development Server

```bash
npm run dev
```

The server starts at `http://localhost:3000` with hot-reload enabled via Nodemon.

## Available Scripts

| Script              | Command                        | Description                                                  |
| ------------------- | ------------------------------ | ------------------------------------------------------------ |
| `npm run dev`       | `nodemon`                      | Start dev server with hot-reload                              |
| `npm run build`     | `tsc`                          | Compile TypeScript to JavaScript in `dist/`                   |
| `npm run start`     | `node dist/index.js`           | Run the compiled production build                             |
| `npm run db:pull`   | `prisma db pull`               | Introspect PostgreSQL and update `prisma/schema.prisma`       |
| `npm run db:generate` | `prisma generate`           | Regenerate the Prisma Client from the schema                  |
| `npm run db:sync`   | `db:pull` + `db:generate`      | Pull schema and regenerate client in one step                 |

## Project Structure

```
backend-api/
├── prisma/
│   └── schema.prisma            # Prisma schema (auto-generated via db pull)
├── src/
│   ├── config/
│   │   └── index.ts             # Centralized environment config
│   ├── controllers/
│   │   ├── auth.controller.ts   # Auth request handlers
│   │   └── health.controller.ts # Health check handler
│   ├── middleware/
│   │   ├── auth.middleware.ts   # JWT authentication & role authorization
│   │   ├── error.middleware.ts  # Global error handler
│   │   └── validate.middleware.ts # Request body validation
│   ├── routes/
│   │   ├── auth.routes.ts       # Auth route definitions
│   │   ├── health.routes.ts     # Health route definitions
│   │   └── index.ts             # Route aggregator (mounted at /api)
│   ├── services/
│   │   └── auth.service.ts      # Auth business logic (dummy data for now)
│   ├── types/
│   │   └── index.ts             # Shared TypeScript interfaces
│   ├── utils/
│   │   ├── logger.ts            # Simple structured logger
│   │   └── response.ts          # Standardized API response helpers
│   ├── prisma.ts                # Prisma client singleton
│   └── index.ts                 # Express app entry point
├── dist/                        # Compiled output (git-ignored)
├── .env                         # Environment variables (git-ignored)
├── .gitignore
├── nodemon.json                 # Nodemon configuration
├── package.json
├── tsconfig.json
└── README.md
```

## API Endpoints

### Health Check

| Method | Endpoint       | Auth     | Description               |
| ------ | -------------- | -------- | ------------------------- |
| GET    | `/api/health`  | Public   | Service & DB health check |

### Authentication

| Method | Endpoint          | Auth     | Description               |
| ------ | ----------------- | -------- | ------------------------- |
| POST   | `/api/auth/register` | Public | Register a new user       |
| POST   | `/api/auth/login`    | Public | Login & get JWT token     |
| GET    | `/api/auth/me`       | Bearer | Get current user profile  |
| POST   | `/api/auth/logout`   | Bearer | Logout (placeholder)     |
| GET    | `/api/auth/users`    | Admin  | List all users            |

### Default Test Credentials

```
Email:    admin@nivasa.com
Password: admin123
Role:     admin
```

### Example: Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@nivasa.com", "password": "admin123"}'
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful.",
  "data": {
    "user": {
      "id": "1",
      "email": "admin@nivasa.com",
      "name": "Admin User",
      "role": "admin"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIs...",
      "expiresIn": "24h"
    }
  }
}
```

### Example: Access Protected Route

```bash
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer <your-jwt-token>"
```

## Response Format

All API responses follow a consistent format:

**Success:**
```json
{
  "success": true,
  "message": "Description of what happened",
  "data": { ... }
}
```

**Error:**
```json
{
  "success": false,
  "message": "What went wrong",
  "error": "ERROR_CODE"
}
```

## Development Workflow

1. **Schema changes** → Apply via Liquibase in the migrations project
2. **Sync ORM** → Run `npm run db:sync` to pull the updated schema and regenerate the Prisma Client
3. **Write code** → Use the type-safe Prisma client in your services
4. **Develop** → Run `npm run dev` for hot-reloading during development

### Adding a New Feature

1. Create a **service** in `src/services/` for the business logic
2. Create a **controller** in `src/controllers/` for request handling
3. Create a **route** file in `src/routes/` and mount it in `src/routes/index.ts`
4. Add any required **types** in `src/types/`

## Building for Production

```bash
# Compile TypeScript
npm run build

# Start production server
npm run start
```

## License

ISC
