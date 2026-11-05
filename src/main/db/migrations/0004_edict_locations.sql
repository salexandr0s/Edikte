CREATE TABLE `edict_locations` (
	`edict_id` text PRIMARY KEY NOT NULL,
	`query` text NOT NULL,
	`lat` real,
	`lng` real,
	`precision` text,
	`provider` text NOT NULL,
	`geocoded_at` text NOT NULL,
	FOREIGN KEY (`edict_id`) REFERENCES `edicts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `edict_locations_query_idx` ON `edict_locations` (`query`);