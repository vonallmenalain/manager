-- `on delete set null` steht hier von Hand: drizzle-kit lässt die Aktion beim
-- Anfügen einer Spalte weg, obwohl das Schema sie führt. Ohne sie scheiterte
-- das Löschen einer Kategorie an einer Notiz, die noch darin liegt – statt sie
-- unsortiert stehen zu lassen, wie es bei einem Dokument geschieht.
ALTER TABLE `notes` ADD `bereich` text DEFAULT 'manager' NOT NULL;--> statement-breakpoint
ALTER TABLE `notes` ADD `category_id` text REFERENCES categories(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `notes_bereich_idx` ON `notes` (`bereich`);--> statement-breakpoint
CREATE INDEX `notes_category_idx` ON `notes` (`category_id`);