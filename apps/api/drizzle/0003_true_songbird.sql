ALTER TABLE `documents` ADD `ocr_method` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `ocr_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `ocr_error` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `ocr_finished_at` text;--> statement-breakpoint
CREATE INDEX `documents_ocr_status_idx` ON `documents` (`ocr_status`);