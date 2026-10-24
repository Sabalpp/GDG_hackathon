# Express API image for Cloud Run. Build from the REPOSITORY ROOT:
#   docker build -f apps/api/Dockerfile -t adapt-api .
# Expects apps/api/package.json to define "build" (tsc -> dist/) and "start"
# (node dist/index.js), and the server to listen on process.env.PORT.
FROM node:22-slim AS build
WORKDIR /workspace
COPY package.json package-lock.json* ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm install --workspace apps/api --include-workspace-root --no-audit --no-fund \
 && npm run build --workspace apps/api --if-present \
 && npm prune --omit=dev --workspace apps/api --include-workspace-root

FROM node:22-slim
# npm start --workspace runs with cwd=apps/api, so read fixtures via ADAPT_DATA_DIR, not ./data.
ENV NODE_ENV=production PORT=8080 ADAPT_DATA_DIR=/workspace/data
WORKDIR /workspace
COPY --from=build /workspace ./
COPY data ./data
USER node
EXPOSE 8080
CMD ["npm", "start", "--workspace", "apps/api"]
