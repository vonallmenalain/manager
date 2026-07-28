ALTER TABLE `documents` ADD `search_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `documents_search_text_idx` ON `documents` (`search_text`);