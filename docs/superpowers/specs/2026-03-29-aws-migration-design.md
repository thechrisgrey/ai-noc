# AI Operations Center: AWS Migration Design

## Overview

Migrate the AI Operations Center from a localhost-only Node.js/SQLite application to a publicly accessible, production-reliable deployment on AWS. The app monitors AI industry news in real-time via RSS/Atom feeds, with WebSocket push notifications, story clustering, and priority scoring.

## Goals

- **Accessible**: Public URL anyone can reach
- **Reliable**: Auto-restart on crash, health checks, automated backups
- **Minimal code changes**: Preserve existing architecture as much as possible

## Architecture

### Topology

```
                         Route 53 (DNS)
                              |
                 +------------+------------+
                 |                         |
           Amplify Hosting            ALB (HTTPS)
           (React SPA +               |
            CloudFront CDN)       ECS Fargate
                                  (Express API +
                                   WebSocket +
                                   Feed Poller)
                                      |
                                  RDS PostgreSQL
                                  (Private Subnet)
```

### Three Components

1. **Amplify Hosting** -- Serves the React SPA via CloudFront CDN. Handles the primary domain. Proxy rewrites route `/api/*` and `/ws` to the ALB.

2. **ECS Fargate** -- Single always-on container running the Express server (API + WebSocket + feed polling). Behind an Application Load Balancer for HTTPS termination and health checks. Auto-restarts on failure.

3. **RDS PostgreSQL** -- `db.t4g.micro` (free tier eligible) in a private subnet. Only accessible from the Fargate security group. Automated backups enabled.

### Networking

- VPC with 2 Availability Zones
- Public subnets: ALB
- Private subnets: Fargate tasks, RDS instance
- NAT Gateway: Enables outbound internet from Fargate (for RSS feed fetching)
- Security groups: ALB allows 443 inbound from anywhere; Fargate allows 5000 from ALB only; RDS allows 5432 from Fargate only

## Database Migration: SQLite to PostgreSQL

### Schema Changes (shared/schema.ts)

| SQLite | PostgreSQL |
|--------|-----------|
| `sqliteTable` | `pgTable` |
| `integer("id").primaryKey({ autoIncrement: true })` | `serial("id").primaryKey()` |
| `integer("is_breaking", { mode: "boolean" })` | `boolean("is_breaking")` |
| `integer("priority")` | `integer("priority")` |
| `text` columns | `text` (no change) |
| Index syntax | No change (Drizzle abstracts) |

### Storage Layer Changes (server/storage.ts)

- Driver: `better-sqlite3` replaced with `pg` (node-postgres)
- ORM import: `drizzle-orm/better-sqlite3` replaced with `drizzle-orm/node-postgres`
- Sync calls (`.all()`, `.get()`, `.run()`) replaced with async equivalents
- Connection via `DATABASE_URL` environment variable
- Connection pool managed by `pg.Pool`

### Dependency Changes

- Remove: `better-sqlite3`, `@types/better-sqlite3`
- Add: `pg`, `@types/pg`

### No changes to

- routes.ts (uses storage interface)
- feedEngine.ts (uses storage interface)
- clustering.ts (uses storage interface)
- priority.ts (uses storage interface)
- All frontend code

## Containerization

### Dockerfile

- Multi-stage build: `node:20-alpine`
- Stage 1: Install dependencies, run `npm run build`
- Stage 2: Copy `dist/`, `node_modules` (production only), run `node dist/index.cjs`
- Expose port 5000

### Server Code Changes

- **Bind address**: `127.0.0.1` changed to `process.env.HOST || "0.0.0.0"`
- **Health endpoint**: `GET /api/health` returns `{ status: "ok", uptime, lastRefreshed }`
- **Graceful shutdown**: SIGTERM handler drains WebSocket connections, closes DB pool, exits cleanly

### Environment Variables

| Variable | Source | Value |
|----------|--------|-------|
| `DATABASE_URL` | Secrets Manager / ECS task def | `postgresql://user:pass@rds-host:5432/ainoc` |
| `PORT` | ECS task def | `5000` |
| `NODE_ENV` | ECS task def | `production` |

## Amplify + ALB Routing

### Amplify Configuration

- Source: Git repository (or manual build artifact upload)
- Build command: `npm run build`
- Output directory: `dist/public/`
- SPA rewrite: All non-file routes serve `/index.html`

### Proxy Rewrites

```
/api/<*>  -->  https://<alb-domain>/api/<*>   (proxy)
/ws       -->  https://<alb-domain>/ws        (proxy)
```

Frontend code does not change -- it continues to call `./api/feed` and connect to `/ws` on the same origin.

### WebSocket Fallback

If Amplify's proxy does not pass WebSocket upgrade headers cleanly, the fallback is:
- Separate subdomain for the ALB: `api-noc.altivum.dev`
- Frontend connects WebSocket to `wss://api-noc.altivum.dev/ws`
- CORS headers added for that origin

### ALB Configuration

- HTTPS listener on port 443 (ACM certificate)
- Target group: Fargate service, port 5000
- Health check: `GET /api/health`, interval 30s, healthy threshold 2
- Stickiness enabled for WebSocket connections

## Infrastructure as Code

### CDK Stack (TypeScript)

Located in `infra/` at the project root. Single stack defines:

- VPC (2 AZs, public + private subnets, NAT Gateway)
- RDS PostgreSQL instance (private subnet)
- ECR repository
- ECS Cluster + Fargate Service + Task Definition
- ALB + target group + HTTPS listener
- Amplify app + domain + rewrite rules
- Secrets Manager for DATABASE_URL

### Deployment Flow

```
Developer pushes code
    |
    +---> Amplify auto-builds React SPA
    |
    +---> docker build + push to ECR + ECS force new deployment
```

Initial deployment: `cdk deploy` brings up all infrastructure. Database schema applied via `drizzle-kit push` against RDS.

CI/CD automation (GitHub Actions) is a follow-up, not required for launch.

## Estimated Cost

| Service | Monthly Cost |
|---------|-------------|
| ECS Fargate (0.25 vCPU, 512MB, always-on) | ~$15 |
| RDS PostgreSQL (db.t4g.micro) | ~$15 (free tier) or ~$30 |
| ALB | ~$16 + data transfer |
| NAT Gateway | ~$32 + data transfer |
| Amplify Hosting | Free tier (< 15GB/mo) |
| Route 53 | ~$0.50 |
| Secrets Manager | ~$0.40 |
| **Total** | **~$50-65/mo** |

Note: NAT Gateway is the most expensive component. An alternative is using Fargate tasks in public subnets with a public IP (saves ~$32/mo but is less secure). This is a viable trade-off for a non-sensitive application.

## Migration Sequence

1. Set up CDK project in `infra/`
2. Migrate schema and storage layer from SQLite to PostgreSQL
3. Add Dockerfile, health endpoint, graceful shutdown
4. Update server bind address to 0.0.0.0
5. Deploy CDK stack (VPC, RDS, ECR, ECS, ALB)
6. Push Docker image, verify API is accessible via ALB
7. Configure Amplify with proxy rewrites
8. Point domain, verify end-to-end
9. Test WebSocket connectivity, feed polling, clustering, priority scoring
