import { useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n/index.ts';
import { type RevealedSpin, renderShareCard, shareFileName, shareText } from './share.ts';

type Props = {
  teamName: string;
  spin: RevealedSpin;
  selectedName: string;
  onClose: () => void;
  onToast: (text: string, error?: boolean) => void;
};

/**
 * Native <dialog> via showModal(): focus trap, Esc handling, backdrop and
 * focus restore on close come for free.
 */
export function ShareDialog({ teamName, spin, selectedName, onClose, onToast }: Props) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const blobRef = useRef<Blob | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    renderShareCard(teamName, spin, selectedName)
      .then((blob) => {
        if (cancelled) return;
        blobRef.current = blob;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => onToast(t('share.imageFailed'), true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [teamName, spin, selectedName, onToast, t]);

  const download = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = shareFileName(spin);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const copyImage = async () => {
    try {
      if (!blobRef.current || !navigator.clipboard || !window.ClipboardItem)
        throw new Error('no clipboard');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobRef.current })]);
      setCopied(true);
      onToast(t('share.imageCopied'));
      setTimeout(() => setCopied(false), 2200);
    } catch {
      download();
      onToast(t('share.copyFailedDownloaded'), true);
    }
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(shareText(teamName, spin, selectedName));
      onToast(t('share.textCopied'));
    } catch {
      onToast(t('share.copyFailed'), true);
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a mouse convenience; the keyboard path is the native Esc handling of <dialog>.
    <dialog
      ref={dialogRef}
      className="share-dialog"
      aria-labelledby="sr-share-h"
      onClose={onClose}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself) closes.
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
    >
      <div className="share-header">
        <h2 id="sr-share-h">{t('share.dialogTitle')}</h2>
        <button
          type="button"
          className="share-close"
          aria-label={t('common.close')}
          onClick={() => dialogRef.current?.close()}
        >
          ×
        </button>
      </div>
      <div className="share-preview">
        <div className="share-image">
          {url && <img src={url} alt={t('share.imageAlt')} />}
          {!url && <div className="share-loading">{t('share.imageLoading')}</div>}
        </div>
      </div>
      <div className="share-footer">
        <button type="button" className="primary share-copy" disabled={!url} onClick={copyImage}>
          {copied ? t('share.copiedLabel') : t('share.copyImageButton')}
        </button>
        <button type="button" className="share-download" disabled={!url} onClick={download}>
          {t('share.downloadButton')}
        </button>
        <button type="button" className="share-textcopy" onClick={copyText}>
          {t('share.copyTextButton')}
        </button>
      </div>
    </dialog>
  );
}
