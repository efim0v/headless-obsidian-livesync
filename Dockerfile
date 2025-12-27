FROM node:22-bookworm-slim

WORKDIR /app

# Ensure UTF-8 locale inside the container so filenames with Cyrillic/Unicode are displayed and handled consistently
# (otherwise many tools show `$'\\320\\...'` escapes for UTF-8 bytes).
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# git is needed if you want to init/update the src/lib submodule inside the container (optional).
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Build the Web UI bundle served on port 80.
RUN npm run build:headless-ui

# Better crash diagnostics in container logs (can be removed later).
ENV NODE_OPTIONS="--trace-uncaught"

# Fail fast with a clear hint if submodule isn't checked out in the build context.
RUN test -f ./src/lib/src/common/types.ts || ( \
  echo >&2 "ERROR: src/lib submodule is missing. Run: git submodule update --init --recursive"; \
  exit 2 \
)

# Headless runner entrypoint (you'll add src/headless/index.ts as part of the headless conversion).
# For now we keep it explicit so the container wiring is ready.
CMD ["npx","tsx","./src/headless/index.ts"]


