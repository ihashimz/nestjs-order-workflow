# Order Workflow

A NestJS reference backend for inventory reservation and order expiry. It demonstrates explicit transaction boundaries, owner authorization, idempotent HTTP requests, and a durable PostgreSQL outbox feeding BullMQ workers. All fixtures are synthetic. This is an original portfolio project, with no claim of production deployment or real payment integration.

**Stack:** Node.js 22, NestJS 11, strict TypeScript, PostgreSQL 16, TypeORM migrations, Passport JWT, Redis 7, BullMQ, class-validator, and Swagger.

## Architecture

```mermaid
flowchart LR
    Client -->|JWT + Idempotency-Key| API[Nest API]
    API --> Auth[Passport / user roles]
    API --> Orders[Order service]
    Orders -->|one transaction| DB[(PostgreSQL)]
    DB --- Inventory[Inventory rows]
    DB --- OrderRows[Order aggregates]
    DB --- Outbox[Durable expiry outbox]
    Dispatcher[Worker: outbox dispatcher] -->|SKIP LOCKED| DB
    Dispatcher -->|stable job ID| Queue[(Redis / BullMQ)]
    Queue --> Expiry[Worker: idempotent expiry]
    Expiry --> Orders
```

The HTTP process handles authentication and feature routes. The worker process owns outbox publication and expiry consumption; API and worker replicas scale independently. Modules group authentication, orders, inventory, health, and background orchestration. Controllers delegate order invariants to `OrdersService`; a small pure policy holds validation and state transitions. TypeORM manages connections, transactions, entity metadata and explicit migrations. Parameterized SQL makes lock order and transaction boundaries visible instead of hiding them behind repository helpers.

## Lifecycle and data model

```mermaid
stateDiagram-v2
    [*] --> pending: reserve inventory
    pending --> confirmed: before deadline
    pending --> cancelled: owner/admin cancels
    pending --> expired: deadline reached
    confirmed --> [*]
    cancelled --> [*]: release once
    expired --> [*]: release once
```

Reservations last 15 minutes. Confirmation keeps the stock deduction, representing committed consumption; no payment provider is involved. Cancellation or expiry restores stock. Terminal orders cannot change to another state. Retrying the same terminal action returns the existing order. An expiry retry after confirmation/cancellation is a harmless no-op. Deadlines and transition checks use PostgreSQL’s clock so API replica clock drift cannot alter the cutoff. Confirmation after the deadline returns a conflict even if the background worker has not run yet.

| Table       | Responsibility                                                                               |
| ----------- | -------------------------------------------------------------------------------------------- |
| `users`     | Operator-seeded owner/admin identities and salted scrypt hashes                              |
| `inventory` | SKU, synthetic name, available stock with a nonnegative check                                |
| `orders`    | Owner, canonical request hash, idempotency key, immutable item snapshot, state, deadline     |
| `outbox`    | One expiry event per order, dispatch attempts, retry eligibility, processing acknowledgement |

### Transaction and idempotency guarantees

1. Creation acquires a PostgreSQL transaction advisory lock for `(owner, key)`, then checks the unique owner/key record. This protects the first concurrent request before an order row exists. Hash collisions in the advisory-lock implementation can only serialize unrelated requests; the unique constraint and exact payload comparison remain authoritative.
2. Items are normalized by SKU. Duplicate SKU lines are rejected; quantities are integers from 1 to 1,000, with 1–50 lines per request. Canonical SHA-256 hashes treat line order as irrelevant. A key replay returns the existing order; different items with the same key return HTTP 409. Keys are scoped to the authenticated owner and retained with orders.
3. Creation locks all inventory rows in SKU order with `FOR UPDATE`, checks every line, decrements stock, inserts the order, and writes its outbox row in **one transaction**. Any failure rolls everything back. Stock cannot be reserved twice by a key replay.
4. Confirmation, cancellation and expiry lock the order row first. Only a pending-to-cancelled/expired transition releases stock, with inventory rows locked in the same SKU order. This prevents double release and resolves confirmation/expiry/cancellation races through the database.
5. Owner IDs come from JWT authentication, never request bodies. Reads filter by owner in SQL; mutations check the locked order owner. Admin identities can inspect and transition any order. Foreign orders return 404. JWT role values are read from the database on each authenticated request, so a token does not preserve a stale role grant.

There is no public registration or role assignment endpoint. The development seed requires environment-supplied passwords and is disabled under `NODE_ENV=production`.

### Durable background processing

The worker polls up to 50 due, unprocessed outbox rows every two seconds using `FOR UPDATE SKIP LOCKED`. Separate worker replicas can claim separate batches. It publishes stable `expiry-<event UUID>` job IDs and advances the next dispatch attempt by 30 seconds. Publication uses five attempts with exponential backoff. A Redis error rolls back the dispatch transaction.

**The outbox event stays unprocessed until a terminal order transaction commits.** Publishing to Redis alone does not acknowledge the event. If the worker crashes after publication, retries find the same job ID. If Redis loses jobs, the durable pending event republishes. If a job exhausts its queue attempts, the dispatcher removes that failed job and republishes it while preserving the database event. Confirmation/cancellation also acknowledge the expiry event transactionally. A crash after committing expiry but before BullMQ acknowledgement is safe: the retried transition releases nothing.

This provides at-least-once dispatch with idempotent database effects. It does not promise exactly-once delivery. Queue failures are logged with job ID and attempt; outbox rows retain dispatch counts. Repeated poison failures stay pending and require operator attention; automatic retries have no global cutoff. Completed jobs are retained for up to one hour / 10,000 jobs. Retention and archival of old orders/outbox rows are operational decisions outside this example.

## Quick start

Use Node 22.22.3 or later on the 22.x line, and locally reachable PostgreSQL/Redis. No cloud account is needed.

```sh
npm ci
cp .env.example .env
```

Set `DATABASE_URL`, `JWT_SECRET` (at least 32 random characters), and both seed passwords (12–128 characters) in the ignored `.env`. Use `openssl rand -hex 32` to generate signing material. `npm` runtime/migration/seed scripts load `.env` through Node's native environment-file support; existing environment variables take precedence.

```sh
npm run migration:run
npm run seed
npm run build
npm start
# In another terminal:
npm run worker
```

Swagger: [http://localhost:3000/docs](http://localhost:3000/docs). Worker health defaults to port 3001. The API exposes `/health` for process liveness and `/ready` for the inventory schema and Redis queue reachability. Both entrypoints enable graceful signal shutdown.

```sh
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.test","password":"YOUR_LOCAL_SEED_PASSWORD"}'

# Set TOKEN to the returned access_token.
curl -X POST http://localhost:3000/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-order-001' \
  -d '{"items":[{"sku":"SYNTHETIC-MUG","quantity":2}]}'
```

### API

All inventory/order routes require a bearer token. DTO validation rejects unknown fields and invalid nested values. Pagination allows up to 100 results and offset 10,000.

| Method | Route                          | Purpose                                           |
| ------ | ------------------------------ | ------------------------------------------------- |
| POST   | `/auth/login`                  | Obtain a 15-minute HS256 access token             |
| GET    | `/auth/me`                     | Current identity and database role                |
| GET    | `/inventory?limit=20&offset=0` | Available synthetic inventory                     |
| POST   | `/orders`                      | Reserve inventory with required `Idempotency-Key` |
| GET    | `/orders?limit=20&offset=0`    | Owner-scoped list; admins see all                 |
| GET    | `/orders/:id`                  | Owner-scoped detail; admins see all               |
| POST   | `/orders/:id/confirm`          | Commit a live reservation                         |
| POST   | `/orders/:id/cancel`           | Release a pending reservation                     |
| GET    | `/health`                      | Process liveness                                  |
| GET    | `/ready`                       | PostgreSQL schema and Redis availability          |

Login allows five attempts per client IP per minute through the standard Nest Throttler guard and returns 429 with retry headers when blocked. Its default storage is per API process; a cluster-wide gateway quota or shared limiter storage is needed when replicas scale. Proxy trust remains disabled, so forwarded client headers cannot bypass the limiter; configure an exact trusted-proxy policy when deploying behind a known ingress. Health and readiness routes are not throttled. JSON bodies are capped at 32 KiB, and password derivation accepts only 12–128 characters.

The API returns 201 for both a new order and an idempotent replay, 400 for validation errors, 401 for invalid authentication, 404 for missing/foreign orders and 409 for stock, key-payload or lifecycle conflicts. `/docs` is public. Request logs include bounded correlation IDs, method, path, status and elapsed time; they omit passwords, tokens and request bodies.

## Containers

Set `POSTGRES_PASSWORD` and `JWT_SECRET` in `.env`; the Compose PostgreSQL password must match any locally configured connection string. The Compose application services use their own internal database URL.

```sh
docker compose up --build -d
# Seed synthetic development accounts through the compiled seed command.
docker compose run --rm \
  -e NODE_ENV=development \
  -e SEED_ADMIN_EMAIL -e SEED_ADMIN_PASSWORD \
  -e SEED_OWNER_EMAIL -e SEED_OWNER_PASSWORD \
  api node dist/database/seed.js
```

Export the seed variables into your shell before the seed command. Compose does not automatically pass them to app containers. The migration service finishes before API/worker startup. PostgreSQL and Redis have named volumes, Redis uses AOF and `noeviction`, and database/Redis ports are internal. The API binds localhost only. The multistage image runs as UID 10001; API/worker have read-only filesystems, dropped capabilities and a writable temporary mount.

## Kubernetes examples

`k8s/base` contains two-replica API/worker Deployments, ConfigMap, a token-free service account, probes, resources, PDBs and default-deny network policies. `k8s/overlays/local` adds single-replica PostgreSQL/Redis StatefulSets with 1 GiB PVCs for demonstration. A default StorageClass and a NetworkPolicy-capable CNI are required. This dependency overlay is not a high-availability database setup.

No Kubernetes Secret values are committed. Provision `order-secrets` containing `DATABASE_URL` and `JWT_SECRET`, and `order-postgres-secret` containing `password`, using your secret manager or local `kubectl create secret`. The database URL for the local overlay uses host `order-postgres`. `REDIS_PASSWORD` is optional for externally managed Redis; configure matching server authentication outside this example.

```sh
kubectl apply -f k8s/base/namespace.yaml
# Create the two named Secrets in namespace order-workflow first.
kubectl apply -k k8s/overlays/local
kubectl apply -f k8s/migrate.yaml
kubectl -n order-workflow wait --for=condition=complete job/order-migrate --timeout=120s
kubectl -n order-workflow rollout status deployment/order-api
kubectl -n order-workflow port-forward service/order-api 3000:3000
```

Readiness fails until the inventory schema exists; migrations run through a separate Job rather than in every API replica. Apply one migration Job per release; remove a finished Job before reusing its name. Set the image digest consistently in both Deployments and the migration Job before deploying a real release. The source defaults to `latest` for demonstration; CI also publishes immutable commit-SHA tags. A public source repository does not guarantee public GHCR package visibility: make the package public for anonymous pulls or configure an `imagePullSecret` on the pod service account.

The ingress allow rule expects an `ingress-nginx` namespace. Customize it for your ingress controller and terminate HTTPS there. Managed external databases need corresponding egress policy and TLS configuration; the base policies intentionally select local dependency pods. The worker's HTTP port is for kubelet probes, with no public Service. PDBs preserve one replica during voluntary disruptions; they do not protect against node failure. CPU HPA is optional:

```sh
# Requires metrics-server and working resource metrics.
kubectl apply -f k8s/hpa.yaml
```

Worker autoscaling should use measured backlog/latency metrics in a real deployment. Queue concurrency is four per worker; database connection pools are ten per process. Scale within PostgreSQL capacity. Production database roles should separate migration privileges from application DML access; the local example uses one development role.

## Verification

```sh
npm run format:check
npm run typecheck
npm test
npm run build
npm audit --omit=dev
kubectl kustomize k8s/base
kubectl kustomize k8s/overlays/local
```

The default suite has 21 passing unit/security tests covering canonical payload hashes, duplicate SKU validation, authorization, overselling through a transaction boundary double, duplicate reservations/releases, database-clock deadline/state behavior, salted passwords, strict DTOs, bounded password derivation, login guard rate limiting, and durable outbox retry behavior. The transaction double models exclusion and rollback; it does not validate PostgreSQL's implementation of row locks.

Six additional integration tests use actual PostgreSQL transactions for concurrent overselling, same-key races, multi-line rollback, confirmation/cancellation and expiry/cancellation races, and owner-scoped queries. They are skipped locally unless `TEST_DATABASE_URL` points to a **dedicated test database**. Each run creates and drops an isolated temporary schema. CI supplies PostgreSQL and runs them automatically.

```sh
TEST_DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/DEDICATED_TEST_DB' npm run test:postgres
```

The compatible Swagger 11.4.7 dependency pins YAML 5.4.0; a scoped npm override selects the patched YAML 5.4.3 release. Revisit this override when Swagger updates its dependency.

Locally verified: TypeScript build/typecheck, unit/security tests, formatting, production dependency audit and Kustomize rendering. Not locally exercised: live PostgreSQL/Redis end-to-end traffic, Docker image startup, a Kubernetes cluster, HPA behavior or cloud operations. Rendering validates Kustomize assembly, not cluster admission or runtime policy enforcement. CI configuration is supplied; its result must be checked after publication.

## Operational boundaries

This example intentionally omits payments, inventory restocking, shipping, refresh tokens, public registration, distributed tracing and a metrics backend. Inventory represents available units rather than a complete accounting ledger. Orders retain item snapshots without pricing. A production rollout should configure HTTPS, shared login throttling across replicas, managed backups, secret rotation, DB/Redis authentication and TLS, and alerts for old pending outbox events and repeated failures. These are deployment requirements, not claims already verified here.

See [the design contract](docs/design.md) and the [Nest documentation](https://docs.nestjs.com/), [PostgreSQL locking documentation](https://www.postgresql.org/docs/current/explicit-locking.html), and [BullMQ job ID guidance](https://docs.bullmq.io/guide/jobs/job-ids) for the underlying mechanisms.
