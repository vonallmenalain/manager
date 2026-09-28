-- Dateien, die in einer Notiz stehen (Foto, PDF). Sie liegen in der Ablage des
-- jeweiligen Bereichs unter `Notizen/` und gehören zur Notiz, nicht zu den
-- Dokumenten. `note_id` ist leer, bis eine Notiz gespeichert wird, die die Datei
-- nennt; was einen Tag lang ohne Notiz bleibt, räumt der Server weg. Bestehende
-- Daten ändern sich nicht – die Tabelle ist neu und leer.
CREATE TABLE `note_files` (
	`id` text PRIMARY KEY NOT NULL,
	`bereich` text DEFAULT 'manager' NOT NULL,
	`note_id` text,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`storage_path` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `note_files_note_idx` ON `note_files` (`note_id`,`created_at`);