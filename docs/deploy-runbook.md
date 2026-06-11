# Deploy Runbook

Ordered hardening and release procedure for ai-noc. Run phases in order; each
phase is independently verifiable before moving on.

Reference IDs (this account):

| Resource | Value |
| --- | --- |
| CloudFront distribution | `EFPOKQM5KJ4EF` (`d289ng5gobnp4e.cloudfront.net`) |
| CloudFront origin-facing prefix list | `pl-3b927c52` (`com.amazonaws.global.cloudfront.origin-facing`, us-east-1) |
| Amplify app | `d22gnzk10dja9z` (ai-noc) |
| Target domain | `noc.altivum.ai` (API origin: `origin.noc.altivum.ai`) |

## Phase 0 — Immediate safety rails

Deploys: RDS deletion protection + snapshot-on-delete + retained automated
backups, ECS deployment circuit breaker with auto-rollback, ALB security group
locked to the CloudFront origin-facing prefix list, and the
`ai-noc/origin-verify` secret injected into the task as `ORIGIN_VERIFY_TOKEN`.

```sh
cd infra
npx cdk diff
npx cdk deploy
```

> **WARNING:** The security group lockdown takes effect the moment this stack
> update lands. Direct requests to the ALB DNS name stop working immediately.
> CloudFront keeps working because its origin-facing IPs are exactly what the
> prefix list allows.

> **WARNING:** The moment `ORIGIN_VERIFY_TOKEN` lands in the container, every
> `/api` endpoint except `/api/health` returns 403 — including through
> CloudFront — until Phase 1 attaches the `X-Origin-Verify` header to the
> origin. `/api/health` is exempt from origin verification, so the verify
> below only proves the stack is up, not that the API is reachable. Proceed
> to Phase 1 immediately; its verify confirms the API works end to end.

Verify:

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://d289ng5gobnp4e.cloudfront.net/api/health   # expect 200 (health is exempt; /api/* stays 403 until Phase 1)
```

## Phase 1 — Origin verification header

The container now requires `X-Origin-Verify` to match the secret (enforced by
the server's `ORIGIN_VERIFY_TOKEN` middleware). Attach the header to the
CloudFront origin so only CloudFront-fronted traffic passes.

1. Read the secret value:

   ```sh
   aws secretsmanager get-secret-value --secret-id ai-noc/origin-verify --query SecretString --output text
   ```

2. Console: CloudFront -> Distributions -> `EFPOKQM5KJ4EF` -> Origins tab ->
   select the AiNoc ALB origin -> Edit -> Add custom header ->
   Name `X-Origin-Verify`, Value `<secret value>` -> Save changes. Wait for the
   distribution to finish deploying.

3. CLI alternative (etag dance):

   ```sh
   aws cloudfront get-distribution-config --id EFPOKQM5KJ4EF > dist.json
   # Note the "ETag" field, then edit dist.json: under DistributionConfig.Origins.Items[<alb origin>].CustomHeaders
   # set Quantity to 1 and add {"HeaderName": "X-Origin-Verify", "HeaderValue": "<secret value>"}.
   # Strip the top-level "ETag" key so only DistributionConfig remains, then:
   aws cloudfront update-distribution --id EFPOKQM5KJ4EF --if-match <ETag> --distribution-config file://dist-config-only.json
   ```

Verify (use a non-exempt endpoint — `/api/health` passes even without the
header, so it cannot prove the header is attached):

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://d289ng5gobnp4e.cloudfront.net/api/feed   # expect 200 (origin verification passes)
curl --max-time 10 http://<alb-dns>/api/feed                                             # expect timeout or 403
```

## Phase 2 — Purge demo data

Run the purge script against production (see `scripts/purge-demo-data.ts`):

```sh
DATABASE_URL=postgresql://<user>:<pass>@<rds-endpoint>:5432/ainoc npx tsx scripts/purge-demo-data.ts
```

## Phase 3 — Release flow

All releases go through `scripts/release.sh`, which builds the image from the
current commit, pushes `<ecr>/ai-noc:<short-sha>`, and deploys the stack pinned
to that tag via `-c imageTag=<short-sha>`:

```sh
./scripts/release.sh
```

Optional env vars are forwarded as CDK context: `DOMAIN_NAME`,
`HOSTED_ZONE_ID`, `HTTP_REDIRECT` (see Phase 4), plus `ECR_URI` / `AWS_REGION`
overrides.

Rollback:

- Bad deploys that fail health checks roll back automatically (ECS deployment
  circuit breaker with rollback enabled).
- To roll back a deployed-but-broken release, check out the previous good
  commit and run `./scripts/release.sh` again; the stack repins to that SHA's
  image. The image is already in ECR, so this is fast.

## Phase 4 — Domain noc.altivum.ai

1. Create a delegated hosted zone `noc.altivum.ai` in Route 53 (same pattern as
   the existing `vetroi.altivum.ai` zone), then add the zone's four NS records
   as an `NS` record set for `noc` in the `altivum.ai` apex zone. Note the new
   zone ID.

2. Amplify custom domain (console): Amplify -> `d22gnzk10dja9z` -> Hosting ->
   Custom domains -> Add domain -> `noc.altivum.ai`. Amplify provisions the
   cert and the DNS records in the delegated zone.

3. Deploy the HTTPS origin (creates the `origin.noc.altivum.ai` ACM cert,
   HTTPS:443 listener, 443 prefix-list ingress, and the alias record):

   ```sh
   DOMAIN_NAME=noc.altivum.ai HOSTED_ZONE_ID=<zone id> ./scripts/release.sh
   ```

4. Switch the CloudFront origin: CloudFront -> `EFPOKQM5KJ4EF` -> Origins ->
   edit the ALB origin -> Origin domain `origin.noc.altivum.ai`, Protocol
   `HTTPS only`. Keep the `X-Origin-Verify` custom header. Wait for deploy.

5. Verify:

   ```sh
   curl -s -o /dev/null -w "%{http_code}\n" https://d289ng5gobnp4e.cloudfront.net/api/health   # expect 200
   curl -s -o /dev/null -w "%{http_code}\n" https://noc.altivum.ai/                            # expect 200 (Amplify)
   ```

6. Final deploy turning the :80 listener into a redirect (only after CloudFront
   is on the HTTPS origin):

   ```sh
   DOMAIN_NAME=noc.altivum.ai HOSTED_ZONE_ID=<zone id> HTTP_REDIRECT=true ./scripts/release.sh
   ```

## Phase 5 — Amplify rewrites

Codified in `scripts/amplify-custom-rules.json`; apply with:

```sh
./scripts/apply-amplify-rewrites.sh
```

This sets the `/api/<*>` 200 reverse-proxy to the CloudFront distribution and
the standard SPA rewrite to `/index.html`.

Notes:

- WebSocket (`/ws`) cannot proxy through Amplify rewrites. The client keeps
  connecting directly to the CloudFront distribution via `VITE_API_URL`; leave
  that Amplify env var pointed at `https://d289ng5gobnp4e.cloudfront.net`.
- Server-side CORS already includes `https://noc.altivum.ai`, so the SPA on the
  custom domain can call the API either via the rewrite or directly.
