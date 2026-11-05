import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DocumentInfo } from '@shared/domain'
import { AppErrorCodeSchema } from '@shared/errors'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { AlertIcon, DocumentIcon, DownloadIcon } from '../../components/ui/icons'
import { ProgressBar } from '../../components/ui/progress-bar'
import { useToast } from '../../components/ui/toast'
import { errorCode, invoke } from '../../lib/bridge'
import { useFormat } from '../../lib/format'
import { useBridgeEvent } from '../../lib/use-bridge-event'
import {
  joinPresent,
  nextDocumentProgress,
  titleAddsToKind,
  type ActiveDocumentProgress,
} from './detail-helpers'
import { useOpenDocument } from './use-detail-actions'

type ProgressMap = ReadonlyMap<number, ActiveDocumentProgress>

/** The listing's documents with download, open and live transfer progress. */
export function DocumentsCard({ documents }: { documents: readonly DocumentInfo[] }) {
  const { t } = useTranslation()
  const [progress, setProgress] = useState<ProgressMap>(() => new Map())
  // Answers of documents:download, shown until the next listing reload has them too.
  const [fetched, setFetched] = useState<ReadonlyMap<number, DocumentInfo>>(() => new Map())

  useBridgeEvent('documents:progress', (event) => {
    const ownIds = new Set(documents.map((doc) => doc.id))
    setProgress((current) => nextDocumentProgress(current, event, ownIds))
  })

  const remember = (info: DocumentInfo) => {
    setFetched((current) => new Map(current).set(info.id, info))
  }

  return (
    <Card title={t('documents.title')}>
      {documents.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('documents.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {documents.map((doc) => {
            const latest = doc.downloaded ? doc : (fetched.get(doc.id) ?? doc)
            return (
              <DocumentRow
                key={doc.id}
                doc={latest}
                progress={latest.downloaded ? null : (progress.get(doc.id) ?? null)}
                onDownloaded={remember}
              />
            )
          })}
        </ul>
      )}
    </Card>
  )
}

interface DocumentRowProps {
  doc: DocumentInfo
  progress: ActiveDocumentProgress | null
  onDownloaded: (info: DocumentInfo) => void
}

function DocumentRow({ doc, progress, onDownloaded }: DocumentRowProps) {
  const { t } = useTranslation()
  const format = useFormat()
  const toast = useToast()
  const openDocument = useOpenDocument()
  const [downloading, setDownloading] = useState(false)
  const [opening, setOpening] = useState(false)
  const kindId = useId()
  const transferring = downloading || progress !== null

  async function download() {
    setDownloading(true)
    try {
      onDownloaded(await invoke('documents:download', { documentId: doc.id }))
    } catch (error) {
      toast({
        kind: 'error',
        title: t('documents.downloadFailed'),
        description: t(`errors.${errorCode(error)}`),
      })
    } finally {
      setDownloading(false)
    }
  }

  async function open() {
    setOpening(true)
    try {
      await openDocument(doc.id)
    } finally {
      setOpening(false)
    }
  }

  const meta = joinPresent(
    [
      doc.statedSizeKb === null ? null : format.fileSize(doc.statedSizeKb),
      doc.pageCount === null ? null : t('documents.pages', { count: doc.pageCount }),
      doc.scannedPages.length === 0
        ? null
        : t('documents.scanned', { count: doc.scannedPages.length }),
    ],
    ' · ',
  )

  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-fill-muted text-fg-muted"
        >
          <DocumentIcon />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p id={kindId} className="text-sm font-medium">
            {t(`documents.kind.${doc.kind}`)}
          </p>
          {titleAddsToKind(doc.title, t(`documents.kind.${doc.kind}`, { lng: 'de' })) && (
            <p lang="de" className="text-xs wrap-break-word text-fg-muted">
              {doc.title}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
            <Badge size="sm" variant={doc.downloaded ? 'success' : 'default'}>
              {doc.downloaded ? t('documents.downloaded') : t('documents.notDownloaded')}
            </Badge>
            {meta !== '' && <span>{meta}</span>}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {!doc.downloaded && (
            <Button
              size="sm"
              variant="secondary"
              loading={transferring}
              aria-describedby={kindId}
              onClick={() => void download()}
            >
              <DownloadIcon />
              {t('documents.download')}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            loading={opening}
            disabled={transferring}
            aria-describedby={kindId}
            onClick={() => void open()}
          >
            {t('documents.open')}
          </Button>
        </div>
      </div>
      {progress !== null && (
        <div className="pl-12">
          <TransferProgress progress={progress} />
        </div>
      )}
      {doc.extractError !== null && (
        <div className="pl-12">
          <ExtractWarning message={doc.extractError} />
        </div>
      )}
    </li>
  )
}

function TransferProgress({ progress }: { progress: ActiveDocumentProgress }) {
  const { t } = useTranslation()
  const format = useFormat()
  const label = t(`documents.phase.${progress.phase}`)
  const { bytesDone, bytesTotal } = progress
  const sized = progress.phase === 'download' && bytesDone !== null && bytesTotal !== null
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between gap-3 text-xs text-fg-muted">
        <span>{label}</span>
        {sized && (
          <span className="tabular-nums">
            {t('documents.bytes', {
              done: format.fileSize(Math.round(bytesDone / 1024)),
              total: format.fileSize(Math.round(bytesTotal / 1024)),
            })}
          </span>
        )}
      </div>
      <ProgressBar label={label} value={sized ? bytesDone : 0} max={sized ? bytesTotal : 0} />
    </div>
  )
}

/** Main stores either an error code or a short technical message. */
function ExtractWarning({ message }: { message: string }) {
  const { t } = useTranslation()
  const code = AppErrorCodeSchema.safeParse(message)
  return (
    <div className="flex items-start gap-2 text-xs text-warning-text">
      <AlertIcon className="mt-0.5" />
      <div className="flex flex-col gap-0.5">
        <p>{t('documents.extractFailed')}</p>
        <p className="text-fg-muted">{code.success ? t(`errors.${code.data}`) : message}</p>
      </div>
    </div>
  )
}
