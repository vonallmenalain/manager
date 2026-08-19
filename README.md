# Manager

Haushalts-Administration als PWA – Dokumente, Pendenzen, Einkaufsliste, Notizen,
Finanzen (Zehnten / Fastopfer) und die Nebenkosten des Hauses für zwei Personen.

**Stand: Etappe 6 abgeschlossen** – alle geplanten Bereiche sind gebaut.
Dokumente lassen sich teilen, aufnehmen, verwalten und **über ihren Inhalt
durchsuchen**: Gescannte Rechnungen werden automatisch gelesen. Der
**Dokumentenmodus** schneidet ein abfotografiertes Blatt selbst zu, entzerrt es
und rechnet den Schatten heraus; **mehrere Seiten** sammeln sich zu einem
einzigen PDF, statt einzeln in der Ablage zu landen. Die
**Einkaufsliste** sortiert nach Ladenabteilungen – selbst angelegt und in die
Reihenfolge des eigenen Rundgangs gebracht – und merkt sich Korrekturen
dauerhaft, **Notizen** gibt es als Text oder Checkliste – privat oder geteilt,
mit Autospeichern, Anheften, Farben und Suche –, und die **Finanzen** rechnen
Zehnten und Fastopfer ab – man hakt die offenen Monate ab, der Rest rechnet
sich daraus, samt verrechenbarem Zehntel der Steuern und CSV-Export. Der
Bereich **Haus** liest die Rechnungen der Energie- und Wasserversorgung direkt
aus dem PDF – Strom, Wasser, Abwasser und Kehricht, mit Verbrauch, Ø Preis je
Einheit und dem Vergleich mit dem Vorjahr, alles zusammen oder je Sparte
einzeln. Das PDF wandert dabei zugleich in die Dokumente.
Offen ist nur noch der Feinschliff, siehe [Roadmap](docs/KONZEPT.md#12-roadmap).

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
apps/web        React-PWAs (Vite, Tailwind, TanStack Query) → Netlify
  src/            Manager – der Haushalt, unter /
  src/docbase/    DocBase – die medizinische Sammlung, unter /docbase
apps/api        Fastify + SQLite + OCR-Worker → Container
packages/shared Typen, Zod-Schemas, Berechnungslogik für beide Seiten
infra           Dockerfile, docker-compose für das QNAP
docs            Konzept und Einrichtungsanleitung
```

Zwei Apps, ein Server, eine Anmeldung. Sie werden getrennt gebaut (zwei
Vite-Konfigurationen), haben je ein eigenes Manifest und einen eigenen Service
Worker und lassen sich deshalb einzeln auf den Startbildschirm legen. Vom
Manager führt bewusst kein Weg in die DocBase.

In die Sammlung der DocBase kommt man auf drei Wegen: **Dokument scannen**,
**Datei wählen** und **Notiz erstellen**. Die Notiz ist dieselbe wie im Manager,
nur mit einer **Kategorie** – sie steht als Kachel zwischen den Dokumenten und
folgt demselben Filter wie sie. Ein „nur für mich" gibt es in der Sammlung
nicht: Wer sie öffnen darf, sieht alles darin.

## Lokal entwickeln

```sh
npm install
npm run build -w @manager/shared      # einmalig, liefert die geteilten Typen
cp .env.example apps/api/.env

npm run dev:api                        # http://localhost:8080
npm run dev:web                        # http://localhost:5173
npm run dev:docbase -w @manager/web    # http://localhost:5174/docbase/
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

Den Dokumentenscanner gibt es unter `npm run dev:web` auch einzeln unter
[/scan-harness.html](http://localhost:5173/scan-harness.html) – ohne Anmeldung
und ohne Backend, dafür mit der Navigationsleiste drumherum. Praktisch, um
Kamerabild, Zuschnitt und Seitenstapel anzuschauen, ohne jedes Mal zum Handy zu
greifen. Die Seite wird nicht mitgebaut.

## Dokumentation

* [Konzept](docs/KONZEPT.md) – Architektur, Datenmodell, Funktionen, Roadmap
* [Einrichtung QNAP / Cloudflare / Netlify](docs/SETUP-QNAP.md) – Schritt für Schritt
