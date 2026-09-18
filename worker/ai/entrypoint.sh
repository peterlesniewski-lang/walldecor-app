#!/bin/sh
set -eu
umask 077

mode="${1:-validate}"
case "$mode" in
  validate)
    test "$#" -le 1 || exit 64
    exec node --import tsx scripts/validate-ai-codex.ts
    ;;
  login|worker)
    test "$#" -eq 1 || exit 64
    ;;
  smoke)
    test "$#" -eq 2 && test "$2" = '--confirm-synthetic-oauth' || exit 64
    ;;
  *) exit 64 ;;
esac

# Never remove/replace this file while any mode is running. It is shared across
# containers using the same dedicated OAuth volume; no auth data is inspected.
mkdir -p /runtime/jobs /runtime/login
exec 9>>/oauth/.session.lock
flock --exclusive --nonblock 9 || { echo 'AI_SESSION_IN_USE' >&2; exit 75; }

case "$mode" in
  login)
    exec env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/runtime/login CODEX_HOME=/oauth \
      /usr/local/bin/codex login --device-auth \
      -c 'forced_login_method="chatgpt"' -c 'cli_auth_credentials_store="file"'
    ;;
  smoke)
    exec node --import tsx scripts/smoke-ai-oauth.ts --confirm-synthetic-oauth \
      --binary /usr/local/bin/codex --catalog /opt/ai/worker/ai/catalog.json \
      --oauth-home /oauth --work-root /runtime/jobs --session-lock-fd 9
    ;;
  worker)
    exec node --import tsx scripts/run-ai-worker.ts
    ;;
esac
