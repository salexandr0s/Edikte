export interface CaseKeyParts {
  court: string | null
  caseNumber: string | null
  /** Object description, such as "Wohnung Stiege 1 Top 25". */
  object: string | null
  /** Edict ID, used when court or case number is missing. */
  id: string
}

/**
 * Key that groups the edicts about one property in one case: the auction, its
 * postponement or cancellation and the Zuschlag share court, case number and
 * object description. Case, punctuation and repeated spaces do not matter, nor
 * does a court code such as "(082)". In the object description spacing does
 * not matter at all: "Top13" and "Top 13" match, while "Top 1, 2" and "Top 12"
 * stay apart.
 */
export function buildCaseKey({ court, caseNumber, object, id }: CaseKeyParts): string {
  const courtPart = keyPart(court?.replace(/\(\s*\d*\s*\)\s*$/, '') ?? null)
  const casePart = keyPart(caseNumber)
  if (courtPart === '' || casePart === '') return `edict:${id}`
  return `${courtPart}|${casePart}|${objectPart(object)}`
}

function keyPart(value: string | null): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}/]+/gu, ' ')
    .trim()
}

/** Letters and digits only; two numbers in a row keep a space between them. */
function objectPart(value: string | null): string {
  let key = ''
  for (const run of keyPart(value).match(/\p{L}+|\p{N}+/gu) ?? []) {
    key += /^\p{N}/u.test(run) && /\p{N}$/u.test(key) ? ` ${run}` : run
  }
  return key
}
