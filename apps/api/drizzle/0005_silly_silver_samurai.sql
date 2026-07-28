CREATE TABLE `shopping_memory` (
	`normalized_text` text PRIMARY KEY NOT NULL,
	`section` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
