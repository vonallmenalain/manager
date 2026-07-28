# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stufe 1: Bauen
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# better-sqlite3 und @node-rs/argon2 bringen für linux/amd64 und linux/arm64
# fertige Binärdateien mit. Die Werkzeuge hier sind nur der Notnagel, falls
# für eine Plattform keine existiert – und bleiben in dieser Stufe zurück.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Erst nur die Manifeste: Solange sich keine Abhängigkeit ändert, bleibt der
# teure npm-ci-Layer im Cache und ein Deploy dauert Sekunden statt Minuten.
#
# Auch apps/web/package.json wird kopiert, obwohl das Frontend nicht ins Image
# gehört: npm gleicht die Sperrdatei gegen ALLE in der Wurzel deklarierten
# Workspaces ab und bricht ab, wenn eines davon fehlt.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci --include-workspace-root \
  --workspace @manager/shared \
  --workspace @manager/api

COPY packages/shared packages/shared
COPY apps/api apps/api

RUN npm run build -w @manager/shared \
  && npm run build -w @manager/api

# Zweiter, sauberer Durchgang ohne Entwicklungs-Abhängigkeiten. Verlässlicher
# als 'npm prune': node_modules wird komplett neu aufgebaut, das Ergebnis ist
# damit unabhängig davon, was der erste Durchgang hinterlassen hat.
# Die bereits gebauten dist-Ordner bleiben unberührt.
RUN npm ci --omit=dev --include-workspace-root \
  --workspace @manager/shared \
  --workspace @manager/api \
  && npm cache clean --force

# ---------------------------------------------------------------------------
# Stufe 2: Laufzeit
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# Texterkennung wird erst ab Etappe 3 genutzt, aber schon jetzt installiert:
# Damit bleibt das Image über alle Etappen stabil und der spätere Ausbau
# braucht keinen Eingriff am NAS. Dank Layer-Caching wird diese Schicht nur
# einmal übertragen, spätere Deploys laden nur die kleine Anwendungsschicht.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ocrmypdf \
    tesseract-ocr \
    tesseract-ocr-deu \
    tesseract-ocr-fra \
    tesseract-ocr-eng \
    poppler-utils \
    ghostscript \
    gosu \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app /app
COPY infra/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production \
    PORT=8080 \
    DB_DIR=/data \
    STORAGE_DIR=/storage

# Wird von der GitHub Action mit dem Git-SHA gefüllt und ist danach über
# /api/health abrufbar – so sieht man sofort, welcher Stand läuft.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "apps/api/dist/index.js"]
