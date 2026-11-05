import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button'
import { useOpenDocument } from './use-detail-actions'

interface PageLinkProps {
  /** The PDF the page belongs to; without one the page shows as plain text. */
  documentId: number | null
  page: number | null
}

/** A small "p. 8" button that opens the PDF at that page. */
export function PageLink({ documentId, page }: PageLinkProps) {
  const { t } = useTranslation()
  const openDocument = useOpenDocument()
  const [opening, setOpening] = useState(false)

  if (page === null) return null
  const label = t('documents.page', { page })
  if (documentId === null) return <span className="text-sm text-fg-muted">{label}</span>

  const target = { documentId, page }
  async function open() {
    setOpening(true)
    try {
      await openDocument(target.documentId, target.page)
    } finally {
      setOpening(false)
    }
  }

  return (
    <Button
      variant="link"
      loading={opening}
      title={t('documents.pageTitle', { page })}
      onClick={() => void open()}
    >
      {label}
    </Button>
  )
}
