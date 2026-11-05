/**
 * Version of the page parsers, stored in `edicts.parserVersion`. Raise it when a
 * parser change alters stored values: the next sync is a full one and reads
 * every edict that an older version parsed, even when its page is unchanged.
 *
 * 2: property type refined from the object title; case keys ignore spacing in
 * the object description.
 */
export const PARSER_VERSION = 2
