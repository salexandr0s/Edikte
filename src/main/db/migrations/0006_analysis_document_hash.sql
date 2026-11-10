ALTER TABLE `analyses` ADD `document_sha256` text;--> statement-breakpoint
ALTER TABLE `area_estimates` ADD `document_sha256` text;--> statement-breakpoint
UPDATE `documents`
SET `extracted_at` = NULL, `page_count` = NULL, `extract_error` = NULL
WHERE `sha256` IS NULL
  OR trim(`sha256`) = ''
  OR julianday(`downloaded_at`) IS NULL
  OR julianday(`extracted_at`) IS NULL
  OR julianday(`downloaded_at`) > julianday(`extracted_at`)
  OR `page_count` IS NULL
  OR `page_count` <= 0
  OR `extract_error` IS NOT NULL;--> statement-breakpoint
UPDATE `analyses`
SET `document_sha256` = (
  SELECT `documents`.`sha256`
  FROM `documents`
  WHERE `documents`.`id` = json_extract(
    CASE WHEN json_valid(`analyses`.`document_ids`) THEN `analyses`.`document_ids` ELSE '[]' END,
    '$[0]'
  )
    AND json_type(
      CASE WHEN json_valid(`analyses`.`document_ids`) THEN `analyses`.`document_ids` ELSE '[]' END,
      '$[0]'
    ) = 'integer'
    AND `documents`.`edict_id` = `analyses`.`edict_id`
    AND `documents`.`sha256` IS NOT NULL
    AND trim(`documents`.`sha256`) <> ''
    AND `documents`.`page_count` > 0
    AND `documents`.`extract_error` IS NULL
    AND `documents`.`downloaded_at` IS NOT NULL
    AND julianday(`documents`.`downloaded_at`) <= julianday(`documents`.`extracted_at`)
    AND julianday(`documents`.`extracted_at`) <= julianday(
      COALESCE(`analyses`.`started_at`, `analyses`.`finished_at`, `analyses`.`created_at`)
    )
)
WHERE `status` = 'done';--> statement-breakpoint
UPDATE `area_estimates`
SET `document_sha256` = (
  SELECT `documents`.`sha256`
  FROM `documents`
  WHERE `documents`.`id` = `area_estimates`.`document_id`
    AND `documents`.`edict_id` = `area_estimates`.`edict_id`
    AND `documents`.`sha256` IS NOT NULL
    AND trim(`documents`.`sha256`) <> ''
    AND `documents`.`page_count` > 0
    AND `documents`.`extract_error` IS NULL
    AND `documents`.`downloaded_at` IS NOT NULL
    AND julianday(`documents`.`downloaded_at`) <= julianday(`documents`.`extracted_at`)
    AND julianday(`documents`.`extracted_at`) <= julianday(`area_estimates`.`created_at`)
);
