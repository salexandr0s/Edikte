-- Full-text index over Gutachten page text. External content: the text lives
-- in document_pages; the triggers keep the index in step with it.
CREATE VIRTUAL TABLE `document_pages_fts` USING fts5(
	`text`,
	content='document_pages',
	content_rowid='id',
	tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `document_pages_fts_insert` AFTER INSERT ON `document_pages` BEGIN
	INSERT INTO `document_pages_fts` (rowid, `text`) VALUES (new.`id`, new.`text`);
END;
--> statement-breakpoint
CREATE TRIGGER `document_pages_fts_delete` AFTER DELETE ON `document_pages` BEGIN
	INSERT INTO `document_pages_fts` (`document_pages_fts`, rowid, `text`) VALUES ('delete', old.`id`, old.`text`);
END;
--> statement-breakpoint
CREATE TRIGGER `document_pages_fts_update` AFTER UPDATE ON `document_pages` BEGIN
	INSERT INTO `document_pages_fts` (`document_pages_fts`, rowid, `text`) VALUES ('delete', old.`id`, old.`text`);
	INSERT INTO `document_pages_fts` (rowid, `text`) VALUES (new.`id`, new.`text`);
END;
