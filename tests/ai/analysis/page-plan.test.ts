import { describe, expect, it } from 'vitest'
import { detectAppendixPages, pageChars, planPages } from '../../../src/main/ai/analysis/page-plan'
import type { AnalysisPage } from '../../../src/main/ai/analysis/types'
import { housePages } from './helpers'

const textPages = housePages.filter((page) => page.hasText).map((page) => page.pageNumber)

function charsOf(pageNumbers: readonly number[]): number {
  return housePages
    .filter((page) => pageNumbers.includes(page.pageNumber))
    .reduce((total, page) => total + pageChars(page), 0)
}

function sorted(pages: Iterable<number>): number[] {
  return [...pages].sort((a, b) => a - b)
}

describe('detectAppendixPages', () => {
  it('finds the photos, the attachments and the signature page before them', () => {
    expect(sorted(detectAppendixPages(housePages))).toEqual([10, 11, 12, 13, 14])
  })

  it('skips table of contents lines and does not open the appendix in the first half', () => {
    const body = (part: number): string =>
      `Befund Teil ${part}. ${'Die Räume sind hell und trocken. '.repeat(15)}`
    const pages: AnalysisPage[] = [
      `Inhalt\nBeilage 1 ........ 7\n${body(1)}`,
      `Grundbuchsauszug\n${body(2)}`,
      `Anhang A: Berechnungen\n${body(3)}`,
      body(4),
      body(5),
      body(6),
      'Beilage 1\nLageplan',
      'Foto 1: Ansicht',
    ].map((text, index) => ({ pageNumber: index + 1, printedLabel: null, hasText: true, text }))
    expect(sorted(detectAppendixPages(pages))).toEqual([2, 3, 7, 8])
  })
})

describe('planPages', () => {
  it('sends scans as images, body pages before appendix pages', () => {
    const plan = planPages(housePages, { imagesSupported: true })
    expect(plan).toMatchObject({
      pageCount: 14,
      imagePages: [6, 12],
      unreadPages: [],
      droppedPages: [],
      appendixPages: [10, 11, 12, 13, 14],
      textChars: charsOf(textPages),
    })
    expect(plan.textPages.map((page) => page.pageNumber)).toEqual(textPages)
    expect(planPages(housePages, { imagesSupported: true, maxImages: 1 })).toMatchObject({
      imagePages: [6],
      unreadPages: [12],
    })
    expect(planPages(housePages, { imagesSupported: false })).toMatchObject({
      imagePages: [],
      unreadPages: [6, 12],
    })
  })

  it('drops appendix pages from the back first, then body pages from the middle', () => {
    const total = charsOf(textPages)
    expect(
      planPages(housePages, { imagesSupported: false, textCharLimit: total - 1 }).droppedPages,
    ).toEqual([14])

    const kept = [1, 2, 3, 7, 8, 9]
    const plan = planPages(housePages, { imagesSupported: false, textCharLimit: charsOf(kept) })
    expect(plan.droppedPages).toEqual([4, 5, 10, 11, 13, 14])
    expect(plan.textPages.map((page) => page.pageNumber)).toEqual(kept)
    expect(plan.textChars).toBe(charsOf(kept))
  })
})

describe('planPages with short text pages', () => {
  const pages: AnalysisPage[] = [
    { pageNumber: 1, printedLabel: null, hasText: true, text: 'Befund und Bewertung der Wohnung' },
    {
      pageNumber: 2,
      printedLabel: null,
      hasText: false,
      text: 'Wien, am 3. März 2025\nUnterschrift',
    },
    { pageNumber: 3, printedLabel: null, hasText: false, text: '' },
  ]

  it('sends any text and renders the pages without enough text of their own', () => {
    const plan = planPages(pages, { imagesSupported: true })
    expect(plan.textPages.map((page) => page.pageNumber)).toEqual([1, 2])
    expect(plan.imagePages).toEqual([2, 3])
    const textOnly = planPages(pages, { imagesSupported: false })
    expect(textOnly.textPages.map((page) => page.pageNumber)).toEqual([1, 2])
    expect(textOnly.unreadPages).toEqual([2, 3])
  })
})
