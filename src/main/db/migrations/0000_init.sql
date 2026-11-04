CREATE TABLE `analyses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`edict_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` integer NOT NULL,
	`schema_version` integer NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`evidence` text DEFAULT '[]' NOT NULL,
	`cross_checks` text DEFAULT '[]' NOT NULL,
	`document_ids` text DEFAULT '[]' NOT NULL,
	`dropped_pages` text DEFAULT '[]' NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_usd` real,
	`error_code` text,
	`error_message` text,
	`raw_response` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`edict_id`) REFERENCES `edicts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `analyses_edict_idx` ON `analyses` (`edict_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `analyses_status_idx` ON `analyses` (`status`);--> statement-breakpoint
CREATE TABLE `area_estimates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`edict_id` text NOT NULL,
	`document_id` integer NOT NULL,
	`kind` text NOT NULL,
	`sqm` real NOT NULL,
	`page` integer NOT NULL,
	`quote` text NOT NULL,
	`confidence` text NOT NULL,
	`method` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`edict_id`) REFERENCES `edicts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `area_estimates_edict_idx` ON `area_estimates` (`edict_id`);--> statement-breakpoint
CREATE TABLE `document_pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer NOT NULL,
	`page_number` integer NOT NULL,
	`printed_label` text,
	`has_text` integer NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_pages_document_page_idx` ON `document_pages` (`document_id`,`page_number`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`edict_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`file_name` text NOT NULL,
	`url` text NOT NULL,
	`stated_size_kb` integer,
	`sha256` text,
	`bytes` integer,
	`page_count` integer,
	`local_path` text,
	`downloaded_at` text,
	`extracted_at` text,
	`extract_error` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`edict_id`) REFERENCES `edicts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_edict_url_idx` ON `documents` (`edict_id`,`url`);--> statement-breakpoint
CREATE INDEX `documents_sha256_idx` ON `documents` (`sha256`);--> statement-breakpoint
CREATE TABLE `edicts` (
	`id` text PRIMARY KEY NOT NULL,
	`case_key` text NOT NULL,
	`notice_type` text NOT NULL,
	`status` text NOT NULL,
	`url` text NOT NULL,
	`court` text,
	`case_number` text,
	`category_label` text,
	`category_codes` text DEFAULT '[]' NOT NULL,
	`property_type` text NOT NULL,
	`title` text NOT NULL,
	`street` text,
	`plz` text,
	`city` text,
	`bundesland` text,
	`bezirk` integer,
	`schaetzwert_eur` real,
	`geringstes_gebot_eur` real,
	`vadium_eur` real,
	`meistbot_eur` real,
	`objektgroesse_sqm` real,
	`objektgroesse_raw` text,
	`grundstuecksgroesse_sqm` real,
	`zubehoer` text,
	`auction_at` text,
	`auction_place` text,
	`viewing` text,
	`grundbuch` text,
	`ez` text,
	`remarks` text,
	`published_at` text,
	`changed_at` text,
	`raw_labels` text NOT NULL,
	`kurzgutachten` text,
	`kurzgutachten_url` text,
	`related_ids` text DEFAULT '[]' NOT NULL,
	`content_hash` text NOT NULL,
	`parser_version` integer NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`fetched_at` text NOT NULL,
	`removed_at` text
);
--> statement-breakpoint
CREATE INDEX `edicts_case_key_idx` ON `edicts` (`case_key`);--> statement-breakpoint
CREATE INDEX `edicts_scope_idx` ON `edicts` (`bundesland`,`status`);--> statement-breakpoint
CREATE INDEX `edicts_auction_at_idx` ON `edicts` (`auction_at`);--> statement-breakpoint
CREATE TABLE `saved_filters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`query` text NOT NULL,
	`preset_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_filters_preset_key_unique` ON `saved_filters` (`preset_key`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`scope` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`listed` integer DEFAULT 0 NOT NULL,
	`fetched` integer DEFAULT 0 NOT NULL,
	`changed` integer DEFAULT 0 NOT NULL,
	`removed` integer DEFAULT 0 NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`note` text,
	`errors` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_state` (
	`case_key` text PRIMARY KEY NOT NULL,
	`starred` integer DEFAULT false NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
