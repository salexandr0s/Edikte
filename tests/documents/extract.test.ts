import { describe, expect, it } from 'vitest'
import { estimateArea } from '../../src/main/documents/estimate'
import { extractPages } from '../../src/main/documents/extract'

/** Builds a PDF from object bodies, numbered from 1, with a correct xref table. */
function buildPdf(objects: readonly string[], trailer = ''): Uint8Array {
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailer}>>\n`
  pdf += `startxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(pdf, 'latin1'))
}

function stream(data: string, dictionary = ''): string {
  return `<< ${dictionary}/Length ${data.length} >>\nstream\n${data}\nendstream`
}

// WinAnsi octal codes: \344 is "ä", \262 is "²".
const TEXT_CONTENT = [
  'BT /F1 11 Tf 72 760 Td (Befund und Beschreibung der Liegenschaft) Tj',
  '0 -16 Td (Die Wohnung liegt im dritten Stock und besteht aus drei Zimmern.) Tj',
  '0 -16 Td (Nutzfl\\344che Wohnung Top 5: 72,40 m\\262) Tj',
  '0 -16 Td (Der Zustand ist gut, die Fenster wurden zuletzt erneuert.) Tj ET',
  'BT /F1 9 Tf 480 30 Td (Seite 1 von 2) Tj ET',
].join('\n')

// Page 1 holds text with a printed footer, page 2 only an image.
const TWO_PAGES = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 7 0 R >> >> /Contents 8 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  stream(TEXT_CONTENT),
  stream(
    '\u0000ÿÿ\u0000',
    '/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 ',
  ),
  stream('q 200 0 0 200 100 400 cm /Im1 Do Q'),
]

describe('extractPages', () => {
  it('reads page text, the printed label and image-only pages', async () => {
    const document = await extractPages(buildPdf(TWO_PAGES))
    expect(document.pageCount).toBe(2)
    const [textPage, imagePage] = document.pages
    expect(textPage).toMatchObject({ pageNumber: 1, hasText: true, printedLabel: 'Seite 1 von 2' })
    expect(textPage?.text).toContain('Nutzfläche Wohnung Top 5: 72,40 m²')
    expect(imagePage).toEqual({ pageNumber: 2, text: '', hasText: false, printedLabel: null })
    expect(estimateArea(document.pages, 'apartment')).toMatchObject({ sqm: 72.4, page: 1 })
  })

  it('rejects bytes that are not a PDF', async () => {
    await expect(extractPages(new TextEncoder().encode('not a pdf'))).rejects.toMatchObject({
      code: 'document_unreadable',
    })
  })

  it('rejects a PDF that needs a password', async () => {
    const encryption = `<< /Filter /Standard /V 2 /R 3 /Length 128 /P -3904 /O <${'ab'.repeat(32)}> /U <${'cd'.repeat(32)}> >>`
    const fileId = `<${'01'.repeat(16)}>`
    const locked = buildPdf([...TWO_PAGES, encryption], `/Encrypt 9 0 R /ID [${fileId} ${fileId}] `)
    await expect(extractPages(locked)).rejects.toMatchObject({
      code: 'document_unreadable',
      message: 'The PDF is protected with a password',
    })
  })
})
