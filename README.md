# BigTrade Backend

Production-ready backend for an Investment, ROI, Referral and Multi-Level Income platform.

**Stack:** Node.js · Express.js · PostgreSQL · Prisma ORM · JWT (access + refresh) · bcrypt · Zod · express-rate-limit · Helmet · CORS · Winston · node-cron · Docker

## Business Rules

| Rule | Value |
|---|---|
| Minimum investment | $100 |
| Earning cap | 5x investment principal |
| Monthly ROI range | 6% – 12% (global / per-user / per-investment) |
| Direct referral commission | 5% of investment amount |
| Level income | 20 levels: 20%, 10%, 7.5%, 5%, 2.5%, 1% (L6-10), 0.5% (L11-20) — on downline ROI |
| Withdrawal | min $10, 5% fee |
| Principal withdrawal | 6-month lock; 10% penalty if withdrawn early |

All money uses `Prisma.Decimal` (PostgreSQL `Decimal(20,2)`). Every balance change creates a `WalletTransaction` ledger row inside a database transaction with row-level locking (`SELECT ... FOR UPDATE`).

## Quick Start

```bash
# 1. Clone & install
git clone <repo> && cd bigTrade_backend
npm install

# 2. Configure environment
cp .env.example .env   # fill JWT secrets + ADMIN_EMAIL/ADMIN_PASSWORD

# 3. Start PostgreSQL via Docker
docker compose up -d

# 4. Prisma
npx prisma generate
npx prisma migrate dev        # or: prisma migrate deploy (production)
npm run prisma:seed           # admin user + 20 commission levels + settings

# 5. Run
npm run dev                   # development (watch mode)
npm start                     # production

# 6. Verify
curl http://localhost:5000/health
```

Swagger docs: **http://localhost:5000/api-docs**

Tests: `npm test` (Jest + ESM, `NODE_OPTIONS=--experimental-vm-modules`)

## API Overview (`/api/v1`)

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | name, email, mobile, password, referralCode? → tokens |
| POST | `/auth/login` | email/mobile + password → accessToken + refreshToken |
| POST | `/auth/refresh` | rotate refresh token |
| POST | `/auth/logout` | revoke refresh token |
| GET | `/auth/me` | current user |

### Users / Profile
| Method | Path | Description |
|---|---|---|
| GET | `/users/me` | profile + wallet |
| PATCH | `/users/me` | update name/mobile |

### Investments
| Method | Path | Description |
|---|---|---|
| POST | `/investments` | `{amount >= 100, idempotencyKey?}` — debits wallet, pays 5% direct commission |
| POST | `/investments/top-up` | `{investmentId, amount}` — new investment cycle (old one CAPPED) |
| GET | `/investments` | paginated list (`?status=`) |
| GET | `/investments/:id` | detail + ROI earnings |

### Wallet
| Method | Path | Description |
|---|---|---|
| GET | `/wallet` | available + locked balances |
| GET | `/wallet/transactions` | ledger (`?type=&page=&limit=`) |

### Withdrawals
| Method | Path | Description |
|---|---|---|
| POST | `/withdrawals` | `{amount >= 10, bankDetails, idempotencyKey?}` — 5% fee, funds locked |
| POST | `/withdrawals/principal` | `{investmentId, bankDetails}` — 6-month lock, 10% early penalty |
| GET | `/withdrawals/principal/:investmentId/eligibility` | penalty/eligible preview |
| GET | `/withdrawals`, `/withdrawals/:id` | history |

### ROI / Referrals / Dashboard
| Method | Path | Description |
|---|---|---|
| GET | `/roi` | current applicable ROI + month summary |
| GET | `/roi/history` | earning records |
| GET | `/referrals`, `/referrals/tree`, `/referrals/level/:level` | team |
| GET | `/referrals/commissions`, `/referrals/commissions/stats` | income |
| GET | `/referrals/stats` | team size / volume |
| GET | `/dashboard` | wallet, investments, incomes, team size |

### Admin (Bearer + ADMIN role)
| Method | Path | Description |
|---|---|---|
| GET/POST | `/admin/users` | list (search/status/role) / create user |
| GET/PATCH | `/admin/users/:userId` | detail / update |
| PATCH | `/admin/users/:userId/status` | suspend/activate |
| GET | `/admin/users/:userId/referral-tree` | full downline tree |
| POST | `/admin/users/:userId/wallet/adjust` | auditable credit/debit |
| GET | `/admin/investments`, `/admin/investments/:id` | all investments |
| PATCH | `/admin/investments/:investmentId/status` | change status |
| GET | `/admin/withdrawals`, `/admin/withdrawals/:id` | queue |
| PATCH | `/admin/withdrawals/:id/approve|reject|complete` | lifecycle (reject needs `reason`) |
| POST/GET | `/admin/roi/global` | set / history of global ROI (`{roiPercent, period: "YYYY-MM"}`) |
| POST/GET/DELETE | `/admin/roi/user/:userId` | per-user custom ROI |
| POST | `/admin/roi/investment/:investmentId` | per-investment ROI |
| GET | `/admin/roi/history`, `/admin/roi/configurations` | processed earnings / all configs |
| POST | `/admin/roi/process` | manual ROI run `{period}` |
| GET | `/admin/commissions`, `/admin/transactions` | ledgers |
| GET | `/admin/dashboard` | platform stats |
| GET | `/admin/audit-logs` | admin action trail |
| GET/PATCH | `/admin/settings` | system settings |

## Consistency & Idempotency

- `RoiEarning` unique on `(investmentId, period)` → ROI can't pay twice
- `Commission` unique on `(userId, type, referenceType, referenceId)` → no double commission
- `Investment.idempotencyKey`, `Withdrawal.idempotencyKey`, `WalletTransaction.idempotencyKey` unique → safe retries
- Withdrawal funds are locked (`available → locked`) at request time; rejection unlocks, approval settles
- All admin mutations write `AuditLog` rows with `adminId`, `ipAddress`, metadata

## Scheduled Jobs

- `roi.job.js` — `0 0 1 * *` monthly ROI + level income, atomic per investment
- `withdrawal.job.js` — hourly stale-withdrawal monitor

## Project Structure

```
src/
├── app.js / server.js
├── config/        env, database (Prisma), logger (Winston)
├── middleware/    auth, admin, error, validation, rate-limit
├── modules/       auth, users, investments, roi, wallet, withdrawals,
│                  referrals, commissions, admin, dashboard
├── jobs/          roi.job.js, withdrawal.job.js
├── utils/         jwt, money (Decimal), roi, commission, referral, pagination
├── validators/    Zod schemas
└── routes/        route mounting + Swagger annotations
prisma/            schema.prisma, migrations, seed.js
```

## Environment Variables

See `.env.example`. Never commit `.env`.

## Docker

```bash
docker compose up -d                       # PostgreSQL only
docker compose --profile app up -d         # PostgreSQL + API in containers
```

`postgres_data` volume persists the database across restarts.
