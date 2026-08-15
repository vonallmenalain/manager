DROP INDEX `categories_bereich_name_idx`;--> statement-breakpoint
ALTER TABLE `categories` ADD `parent_id` text REFERENCES categories(id) ON DELETE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX `categories_bereich_parent_name_idx` ON `categories` (`bereich`,`parent_id`,`name`);--> statement-breakpoint
CREATE INDEX `categories_parent_idx` ON `categories` (`parent_id`);