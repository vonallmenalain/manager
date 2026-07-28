# Manager

Haushalts-Administration als PWA – Dokumente, Pendenzen, Einkaufsliste, Notizen
und Finanzen (Zehnten / Fastopfer) für zwei Personen.

> **Status:** Konzeptphase. Noch kein Code – siehe [docs/KONZEPT.md](docs/KONZEPT.md).

## Idee in einem Satz

Ein Dokument vom Handy in unter zehn Sekunden erfassen, per Volltext wiederfinden,
und jederzeit sehen was noch offen ist – ohne dass Daten das eigene NAS verlassen.

## Architektur in Kürze

| Teil | Wo |
|---|---|
| Frontend (PWA) | Netlify → `manager.alae.app` |
| Backend (API + OCR) | Container auf dem QNAP → `api.alae.app` via Cloudflare Tunnel |
| Datenbank | SQLite auf einem QNAP-Volume |
| Dateien | QNAP-Freigabe, ausserhalb des Containers, menschenlesbare Ordnerstruktur |
| Deployment | `git push` → GitHub Actions → GHCR → Watchtower zieht automatisch |

## Dokumentation

* [Konzept](docs/KONZEPT.md) – Architektur, Datenmodell, Funktionen, Roadmap
