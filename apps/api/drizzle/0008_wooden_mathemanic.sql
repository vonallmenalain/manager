ALTER TABLE `notes` ADD `shared` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `notes_visibility_idx` ON `notes` (`created_by`,`shared`);