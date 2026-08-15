CREATE TABLE `shopping_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 100 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shopping_sections_sort_idx` ON `shopping_sections` (`sort_order`,`name`);--> statement-breakpoint
-- Die Erstausstattung – bisher eine feste Liste im Programmtext, ab jetzt
-- gewöhnliche Zeilen, die sich umbenennen, umordnen und ergänzen lassen. Die
-- Kennungen sind lesbare Kürzel und keine Zufallszahlen: In einer Datenbank,
-- die man notfalls von Hand repariert, soll man sehen, was ein Verweis meint.
INSERT INTO `shopping_sections` (`id`, `name`, `sort_order`) VALUES
	('fruechte-gemuese', 'Früchte & Gemüse', 10),
	('brot-backwaren', 'Brot & Backwaren', 20),
	('molkerei', 'Molkerei', 30),
	('fleisch-fisch', 'Fleisch & Fisch', 40),
	('vorrat', 'Vorrat', 50),
	('tiefkuehl', 'Tiefkühl', 60),
	('getraenke', 'Getränke', 70),
	('haushalt', 'Haushalt', 80),
	('sonstiges', 'Sonstiges', 90);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_shopping_items` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`normalized_text` text NOT NULL,
	`section_id` text NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`done_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`done_at` text,
	FOREIGN KEY (`section_id`) REFERENCES `shopping_sections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`done_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
-- Bisher stand der Name der Abteilung im Eintrag, jetzt ihre Kennung. Was zu
-- keiner Abteilung passt, landet unter „Sonstiges" – das ist derselbe Ort, an
-- dem es vorher auch stand, wenn niemand es zugeordnet hatte.
INSERT INTO `__new_shopping_items`("id", "text", "normalized_text", "section_id", "done", "created_by", "done_by", "created_at", "done_at")
SELECT
	"id",
	"text",
	"normalized_text",
	COALESCE((SELECT `s`.`id` FROM `shopping_sections` `s` WHERE `s`.`name` = `shopping_items`.`section`), 'sonstiges'),
	"done",
	"created_by",
	"done_by",
	"created_at",
	"done_at"
FROM `shopping_items`;--> statement-breakpoint
DROP TABLE `shopping_items`;--> statement-breakpoint
ALTER TABLE `__new_shopping_items` RENAME TO `shopping_items`;--> statement-breakpoint
CREATE INDEX `shopping_done_idx` ON `shopping_items` (`done`);--> statement-breakpoint
CREATE INDEX `shopping_normalized_idx` ON `shopping_items` (`normalized_text`);--> statement-breakpoint
CREATE INDEX `shopping_section_idx` ON `shopping_items` (`section_id`);--> statement-breakpoint
CREATE TABLE `__new_shopping_memory` (
	`normalized_text` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `shopping_sections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Das Gelernte wandert mit: Wer „Vollmilch" einmal in die Molkerei gelegt hat,
-- soll es beim nächsten Einkauf wieder dort finden. Eine Erinnerung an eine
-- Abteilung, die es nie gab, wäre wertlos und fällt hier weg.
INSERT INTO `__new_shopping_memory`("normalized_text", "section_id", "updated_at")
SELECT
	"normalized_text",
	(SELECT `s`.`id` FROM `shopping_sections` `s` WHERE `s`.`name` = `shopping_memory`.`section`),
	"updated_at"
FROM `shopping_memory`
WHERE EXISTS (SELECT 1 FROM `shopping_sections` `s` WHERE `s`.`name` = `shopping_memory`.`section`);--> statement-breakpoint
DROP TABLE `shopping_memory`;--> statement-breakpoint
ALTER TABLE `__new_shopping_memory` RENAME TO `shopping_memory`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
