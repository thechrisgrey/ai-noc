#!/usr/bin/env bash
set -euo pipefail

# Build the image from the current commit, push it to ECR, and deploy the CDK
# stack pinned to that exact tag. Optional env vars:
#   ECR_URI         full repo URI (default: <account>.dkr.ecr.<region>.amazonaws.com/ai-noc)
#   AWS_REGION      region (default: us-east-1)
#   DOMAIN_NAME     forwarded as -c domainName=...
#   HOSTED_ZONE_ID  forwarded as -c hostedZoneId=...
#   HTTP_REDIRECT   forwarded as -c httpRedirect=...
#   DIGEST_EMAIL_TO forwarded as -c digestEmailTo=... (digest recipient; empty disables)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGION="${AWS_REGION:-us-east-1}"

if [ -z "${ECR_URI:-}" ]; then
  ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
  ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/ai-noc"
fi

TAG="$(git -C "$ROOT" rev-parse --short HEAD)"
REGISTRY="${ECR_URI%%/*}"

echo "Releasing $ECR_URI:$TAG"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"

# Fargate task runs LINUX/X86_64; never push a host-arch (arm64) image.
docker build --platform linux/amd64 -t "$ECR_URI:$TAG" "$ROOT"
docker push "$ECR_URI:$TAG"

CDK_ARGS=(-c "imageTag=$TAG")
if [ -n "${DOMAIN_NAME:-}" ]; then
  CDK_ARGS+=(-c "domainName=$DOMAIN_NAME")
fi
if [ -n "${HOSTED_ZONE_ID:-}" ]; then
  CDK_ARGS+=(-c "hostedZoneId=$HOSTED_ZONE_ID")
fi
if [ -n "${HTTP_REDIRECT:-}" ]; then
  CDK_ARGS+=(-c "httpRedirect=$HTTP_REDIRECT")
fi
if [ -n "${DIGEST_EMAIL_TO:-}" ]; then
  CDK_ARGS+=(-c "digestEmailTo=$DIGEST_EMAIL_TO")
fi

cd "$ROOT/infra"
npx cdk deploy "${CDK_ARGS[@]}" --require-approval never
