# Pin the built Linux image by digest and repeat the boundary proof before enablement.
FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates poppler-utils util-linux tini fonts-dejavu-core \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/ai
COPY worker/ai/package.json worker/ai/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && ln -s /opt/ai/node_modules/.bin/codex /usr/local/bin/codex \
    && test "$(codex --version)" = "codex-cli 0.153.4" \
    && npm cache clean --force

# Only standalone runtime code and policy: no application checkout or database access.
COPY src/lib/ai/codex-policy.ts src/lib/ai/codex-runner.ts src/lib/ai/contracts.ts src/lib/ai/prompts.ts ./src/lib/ai/
COPY src/lib/ai/worker-client.ts src/lib/ai/worker-consumer.ts src/lib/ai/queue-errors.ts ./src/lib/ai/
COPY src/lib/invoice-import/contracts.ts src/lib/invoice-import/document-processor.ts ./src/lib/invoice-import/
COPY scripts/validate-ai-codex.ts scripts/run-ai-worker.ts scripts/smoke-ai-oauth.ts ./scripts/
COPY worker/ai/catalog.json ./worker/ai/catalog.json
COPY --chmod=755 worker/ai/entrypoint.sh ./worker/ai/entrypoint.sh

RUN mkdir -p /oauth /runtime \
    && chown node:node /oauth /runtime \
    && chmod 0700 /oauth /runtime

ENV NODE_ENV=production \
    TMPDIR=/runtime \
    AI_CODEX_HOME=/oauth \
    AI_WORK_ROOT=/runtime/jobs \
    AI_CODEX_BINARY=/usr/local/bin/codex \
    AI_CODEX_CATALOG=/opt/ai/worker/ai/catalog.json

USER node
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/ai/worker/ai/entrypoint.sh"]
# No login or inference by default. Explicit enablement follows the Linux/OAuth gates.
CMD ["validate"]
