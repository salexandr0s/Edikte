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
 * object description. Spacing, punctuation, case and a court code such as
 * "(082)" do not matter.
 */
export function buildCaseKey({ court, caseNumber, object, id }: CaseKeyParts): string {
  const courtPart = keyPart(court?.replace(/\(\s*\d*\s*\)\s*$/, '') ?? null)
  const casePart = keyPart(caseNumber)
  if (courtPart === '' || casePart === '') return `edict:${id}`
  return `${courtPart}|${casePart}|${keyPart(object)}`
}

function keyPart(value: string | null): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}/]+/gu, ' ')
    .trim()
}
