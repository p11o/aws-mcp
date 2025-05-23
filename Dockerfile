FROM ubuntu:22.04 AS base
COPY bin bin
RUN apt update && apt install git -y && ./bin/get-smith-api-models

FROM oven/bun:latest AS prod

WORKDIR /app
ENV BUN_INSTALL_CACHE_DIR=/app/.bun


COPY --from=base aws-sdk-js-v3 /app/aws-sdk-js-v3
COPY package.json /app/package.json
COPY bun.lock /app/bun.lock

RUN bun install
COPY server.ts /app/server.ts
COPY lib /app/lib

ENTRYPOINT [ "bun", "server.ts" ]

FROM prod AS dev
ENV BUN_INSTALL_CACHE_DIR=/app/.bun

ENV CLIENT_PORT=6274
ENV SERVER_PORT=6277
ENTRYPOINT ["bun", "x", "@modelcontextprotocol/inspector", "bun", "server.ts"]
