# Manager

Haushalts-Administration als PWA – Dokumente, Pendenzen, Einkaufsliste, Notizen
und Finanzen (Zehnten / Fastopfer) für zwei Personen.

**Stand: Etappe 5 abgeschlossen** – alle geplanten Bereiche sind gebaut.
Dokumente lassen sich teilen, aufnehmen, verwalten und **über ihren Inhalt
durchsuchen**: Gescannte Rechnungen werden automatisch gelesen. Die
**Einkaufsliste** sortiert nach Ladenabteilungen und merkt sich Korrekturen
dauerhaft, **Notizen** haben Anheften, Farben und Suche, und die **Finanzen**
rechnen Zehnten und Fastopfer ab – mit Steuerabzug, Abrechnungsstand und
CSV-Export. Offen ist nur noch der Feinschliff, siehe
[Roadmap](docs/KONZEPT.md#12-roadmap).

## Idee in einem Satz

Ein Dokument vom Handy in unter zehn Sekunden erfassen, per Volltext wiederfinden,
und jederzeit sehen was noch offen ist – ohne dass Daten das eigene NAS verlassen.

## Architektur

| Teil | Wo |
|---|---|
| Frontend (PWA) | Netlify → `manager.alae.app` |
| Backend (API + OCR) | Container auf dem QNAP → `manager-api.alae.app` via Cloudflare Tunnel |
| Datenbank | SQLite auf einem QNAP-Volume, ausserhalb des Containers |
| Dateien | QNAP-Freigabe, menschenlesbare Ordnerstruktur |
| Deployment | `git push` → GitHub Actions → GHCR → Watchtower zieht automatisch |

## Projektstruktur

```
apps/web        React-PWA (Vite, Tailwind, TanStack Query) → Netlify
apps/api        Fastify + SQLite + OCR-Worker → Container
packages/shared Typen, Zod-Schemas, Berechnungslogik für beide Seiten
infra           Dockerfile, docker-compose für das QNAP
docs            Konzept und Einrichtungsanleitung
```

## Lokal entwickeln

```sh
npm install
npm run build -w @manager/shared      # einmalig, liefert die geteilten Typen
cp .env.example apps/api/.env

npm run dev:api                        # http://localhost:8080
npm run dev:web                        # http://localhost:5173
```

Beim ersten Aufruf erscheint die Ersteinrichtung. Der dort verlangte Token
steht als `SETUP_TOKEN` in `apps/api/.env`.

## Nützliche Befehle

| Befehl | Zweck |
|---|---|
| `npm run typecheck` | Typen über alle Workspaces prüfen |
| `npm test` | Unit-Tests |
| `npm run build` | Alles bauen, wie in der CI |
| `npm run audit` | Sicherheitsprüfung gegen `security-exceptions.json` |
| `npm run db:generate -w @manager/api` | SQL-Migration aus dem Schema erzeugen |

Nach jeder Änderung an `apps/api/src/db/schema.ts` muss `db:generate` laufen –
die CI prüft das und schlägt sonst fehl.

## Dokumentation

* [Konzept](docs/KONZEPT.md) – Architektur, Datenmodell, Funktionen, Roadmap
* [Einrichtung QNAP / Cloudflare / Netlify](docs/SETUP-QNAP.md) – Schritt für Schritt
