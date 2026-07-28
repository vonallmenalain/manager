CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`color` text DEFAULT 'default' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `notes_pinned_idx` ON `notes` (`pinned`,`updated_at`);--> statement-breakpoint
CREATE INDEX `notes_search_idx` ON `notes` (`search_text`);--> statement-breakpoint
CREATE TABLE `shopping_items` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`normalized_text` text NOT NULL,
	`section` text DEFAULT 'Sonstiges' NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`done_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`done_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`done_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `shopping_done_idx` ON `shopping_items` (`done`);--> statement-breakpoint
CREATE INDEX `shopping_normalized_idx` ON `shopping_items` (`normalized_text`);