# shellcheck shell=bash
# Sourced (never run) by the scripts in this directory that call AWS. It pins
# them to the account AiNocStack lives in (the Altivum account), so the shell's
# AWS_PROFILE (Delta Centric personal-dev in interactive shells) can never
# redirect a release.
#
#   AI_NOC_AWS_PROFILE  profile to use (default: altivum-og, Altivum SSO)
#   AINOC_AWS_ACCOUNT   expected 12-digit account id. Without it, the id is read
#                       from .aws-account at the repo root (gitignored, one line).
#                       With neither, this refuses. infra/app.ts reads the same.
#
# The account check always applies, whichever profile is chosen.

_ai_noc_account_file="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/.aws-account"
AI_NOC_EXPECTED_ACCOUNT="${AINOC_AWS_ACCOUNT:-}"
_ai_noc_account_source="AINOC_AWS_ACCOUNT"
if [ -z "${AI_NOC_EXPECTED_ACCOUNT//[[:space:]]/}" ] && [ -e "$_ai_noc_account_file" ]; then
  _ai_noc_account_source="$_ai_noc_account_file"
  if ! AI_NOC_EXPECTED_ACCOUNT="$(cat -- "$_ai_noc_account_file")"; then
    echo "aws-preflight: cannot read $_ai_noc_account_file. Refusing to continue." >&2
    exit 1
  fi
fi
# Trim surrounding whitespace (a trailing newline or CRLF), as infra/app.ts does.
AI_NOC_EXPECTED_ACCOUNT="${AI_NOC_EXPECTED_ACCOUNT#"${AI_NOC_EXPECTED_ACCOUNT%%[![:space:]]*}"}"
AI_NOC_EXPECTED_ACCOUNT="${AI_NOC_EXPECTED_ACCOUNT%"${AI_NOC_EXPECTED_ACCOUNT##*[![:space:]]}"}"
if [ -z "$AI_NOC_EXPECTED_ACCOUNT" ]; then
  echo "aws-preflight: no expected AWS account for ai-noc. Set AINOC_AWS_ACCOUNT=<12-digit id>, or write the id on one line to $_ai_noc_account_file (gitignored). Refusing to continue." >&2
  exit 1
fi
if ! [[ "$AI_NOC_EXPECTED_ACCOUNT" =~ ^[0-9]{12}$ ]]; then
  echo "aws-preflight: $_ai_noc_account_source must hold a 12-digit AWS account id. Refusing to continue." >&2
  exit 1
fi

export AWS_PROFILE="${AI_NOC_AWS_PROFILE:-altivum-og}"
# Exported keys outrank AWS_PROFILE for the aws CLI; drop them so the profile
# is the only credential source for this script and everything it runs.
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN

if ! _ai_noc_account="$(aws sts get-caller-identity --query Account --output text)"; then
  echo "aws-preflight: STS failed for profile '$AWS_PROFILE' (expired SSO? run: aws sso login --profile $AWS_PROFILE)" >&2
  exit 1
fi
if [ "$_ai_noc_account" != "$AI_NOC_EXPECTED_ACCOUNT" ]; then
  echo "aws-preflight: profile '$AWS_PROFILE' is account $_ai_noc_account, but ai-noc lives in $AI_NOC_EXPECTED_ACCOUNT (from $_ai_noc_account_source). Refusing to continue." >&2
  exit 1
fi
echo "aws-preflight: profile $AWS_PROFILE, account $_ai_noc_account" >&2
unset _ai_noc_account _ai_noc_account_file _ai_noc_account_source
