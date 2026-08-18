ALTER TABLE `notes` ADD `bereich` text DEFAULT 'manager' NOT NULL;--> statement-breakpoint
ALTER TABLE `notes` ADD `category_id` text REFERENCES categories(id);--> statement-breakpoint
CREATE INDEX `notes_bereich_idx` ON `notes` (`bereich`);--> statement-breakpoint
CREATE INDEX `notes_category_idx` ON `notes` (`category_id`);