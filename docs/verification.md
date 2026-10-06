# Local verification record

Verified on 2026-10-06 with Node 22.22.3, npm 10.9.8 and kubectl 1.33.9 / Kustomize 5.6.0.

| Check                                                             | Result                                                                                                                                   |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                                                   | Passed                                                                                                                                   |
| `npm run typecheck`                                               | Passed                                                                                                                                   |
| `npm run format:check`                                            | Passed                                                                                                                                   |
| `npm test`                                                        | 21 passed, 6 PostgreSQL integration tests skipped                                                                                        |
| `npm audit --omit=dev --json`                                     | 0 production advisories                                                                                                                  |
| `docker compose config --quiet` with synthetic environment values | Passed; no daemon or containers started                                                                                                  |
| `kubectl kustomize k8s/base`                                      | 14 rendered resources                                                                                                                    |
| `kubectl kustomize k8s/overlays/local`                            | 18 rendered resources                                                                                                                    |
| Rendered manifest inspection                                      | Deployment/StatefulSet non-root, read-only filesystem, token mounting disabled, probes and resource limits present; no committed Secrets |

The initial order test cycle observed 11 failing invariant tests against deliberately incomplete stubs, then passed after implementation. Password/DTO validation and durable outbox tests also failed before implementation. Additional database-clock and rate-limiter/password-boundary tests observed their intended failures before fixes.

The PostgreSQL suite is configured in CI with an isolated test schema and a PostgreSQL service. It was not run locally: no live PostgreSQL/Redis setup, Docker startup or Kubernetes cluster was requested. No live queue retries, cluster admissions, network policy enforcement, HPA behavior, load performance or cloud deployment were verified. Check CI results after publication before reporting the integration suite as passing.
