/**
 * Version of the page parsers, stored in `edicts.parserVersion`. Raise it when a
 * parser change alters stored values: the next full sync fetches every edict
 * that an older version parsed, even when its page is unchanged.
 */
export const PARSER_VERSION = 1
