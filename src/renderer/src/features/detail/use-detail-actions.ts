import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/ui/toast'
import { errorCode, invoke } from '../../lib/bridge'
import { useFormat } from '../../lib/format'

/**
 * Opens a document in its PDF window, at a page when one is given. Main
 * downloads the file first when needed. A failure ends in an error toast.
 */
export function useOpenDocument(): (documentId: number, page?: number) => Promise<void> {
  const { t } = useTranslation()
  const toast = useToast()
  return useCallback(
    async (documentId: number, page?: number) => {
      try {
        await invoke('documents:open', page === undefined ? { documentId } : { documentId, page })
      } catch (error) {
        toast({
          kind: 'error',
          title: t('documents.openFailed'),
          description: t(`errors.${errorCode(error)}`),
        })
      }
    },
    [t, toast],
  )
}

/** Opens a page of edikte.justiz.gv.at in the system browser. */
export function useOpenExternal(): (url: string) => Promise<void> {
  const { t } = useTranslation()
  const toast = useToast()
  return useCallback(
    async (url: string) => {
      try {
        await invoke('shell:openExternal', { url })
      } catch (error) {
        toast({
          kind: 'error',
          title: t('detail.openFailed'),
          description: t(`errors.${errorCode(error)}`),
        })
      }
    },
    [t, toast],
  )
}

/**
 * Formats a percentage such as 12.34 as "12.3%", with a plus sign on request.
 * Negative values get a real minus sign; Intl writes a hyphen for de-AT and en-GB.
 */
export function usePercent(): (percent: number, signed?: boolean) => string {
  const { t } = useTranslation()
  const format = useFormat()
  return useCallback(
    (percent: number, signed = false) => {
      const rounded = Math.round(percent * 10) / 10
      const sign = rounded < 0 ? '−' : signed && rounded > 0 ? '+' : ''
      return t('detail.percent', { value: `${sign}${format.number(Math.abs(rounded), 1)}` })
    },
    [t, format],
  )
}
