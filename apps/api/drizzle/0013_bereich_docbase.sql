DROP INDEX `categories_name_unique`;--> statement-breakpoint
ALTER TABLE `categories` ADD `bereich` text DEFAULT 'manager' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `categories_bereich_name_idx` ON `categories` (`bereich`,`name`);--> statement-breakpoint
ALTER TABLE `documents` ADD `bereich` text DEFAULT 'manager' NOT NULL;--> statement-breakpoint
CREATE INDEX `documents_bereich_idx` ON `documents` (`bereich`);