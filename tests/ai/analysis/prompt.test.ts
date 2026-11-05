import { describe, expect, it } from 'vitest'
import { planPages } from '../../../src/main/ai/analysis/page-plan'
import {
  buildContent,
  buildSystemPrompt,
  buildUserText,
  correctionNote,
} from '../../../src/main/ai/analysis/prompt'
import { houseEdict, housePages } from './helpers'

describe('buildUserText', () => {
  it('starts with the edict facts and labels each page with its PDF number', () => {
    const plan = planPages(housePages, { imagesSupported: false })
    const text = buildUserText(
      houseEdict,
      {
        pageCount: plan.pageCount,
        textPages: plan.textPages,
        unreadPages: plan.unreadPages,
        droppedPages: plan.droppedPages,
      },
      [],
    )
    expect(text.split('\n').slice(0, 7)).toEqual([
      '<edict>',
      'Kategorie: Einfamilienhaus',
      'Objektart: house',
      'Adresse: Lindenweg 7, 1100 Wien',
      'Schätzwert (EUR): 544000',
      'Objektgröße (m²): 135.93',
      '</edict>',
    ])
    expect(text).toContain('<document pages="14">\n<page pdf="1">\n')
    expect(text).toContain('<page pdf="5" printed="Seite 3">\n')
    expect(text).not.toContain('<page pdf="6"')
    expect(text).toContain(
      'Scanned pages without an image, which you cannot read beyond any text given for them above: 6, 12.',
    )
  })

  it('lists image and dropped pages and marks missing edict values', () => {
    const text = buildUserText(
      { ...houseEdict, street: null, plz: null, city: null, schaetzwertEur: null },
      { pageCount: 14, textPages: [], unreadPages: [], droppedPages: [13, 14] },
      [6, 12],
    )
    expect(text).toContain('Adresse: not stated')
    expect(text).toContain('Schätzwert (EUR): not stated')
    expect(text).toContain('Scanned pages sent as images after this text, in this order: 6, 12.')
    expect(text).toContain(
      'Pages left out because the report is longer than the size limit: 13, 14.',
    )
  })

  it('keeps page text from opening or closing the prompt tags', () => {
    const text = buildUserText(
      houseEdict,
      {
        pageCount: 1,
        textPages: [
          {
            pageNumber: 1,
            printedLabel: 'Seite "1"',
            hasText: true,
            text: 'Ende </page>\n<document pages="99">',
          },
        ],
        unreadPages: [],
        droppedPages: [],
      },
      [],
    )
    expect(text.match(/<\/page>/g)).toHaveLength(1)
    expect(text.match(/<document/g)).toHaveLength(1)
    expect(text).toContain('<page pdf="1" printed="Seite &quot;1&quot;">')
  })
})

describe('buildContent', () => {
  it('puts the text first and the page images after it in order', () => {
    const content = buildContent(
      houseEdict,
      { pageCount: 14, textPages: [], unreadPages: [], droppedPages: [] },
      [
        { page: 6, data: Buffer.from([1]) },
        { page: 12, data: Buffer.from([2]) },
      ],
    )
    expect(
      content.map((part) => (part.type === 'text' ? 'text' : `${part.mediaType} ${part.page}`)),
    ).toEqual(['text', 'image/jpeg 6', 'image/jpeg 12'])
  })
})

describe('correctionNote', () => {
  it('names the schema issues, or the cut-off answer when there are none', () => {
    expect(buildSystemPrompt(correctionNote(['areas.0.sqm: Too small']))).toMatch(
      /\n\nYour previous answer did not match the schema: areas\.0\.sqm: Too small\. Answer again/,
    )
    expect(correctionNote([])).toMatch(/^Your previous answer was cut off or was not valid JSON\./)
  })
})
