import { useEffect, useState, useRef, useCallback } from 'react';
import { getPlatform } from '../platform';
import { useI18n } from '../i18n';

type FileItem = {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
};

type Props = {
  file: FileItem;
  onClose: () => void;
};

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.tif', '.tiff', '.heic', '.heif']);
const TEXT_EXTS = new Set([
  '.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.toml', '.ini', '.env',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp',
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.sh', '.bash', '.zsh', '.fish',
  '.sql', '.graphql', '.proto',
  '.xml', '.csv', '.log',
]);

function getExt(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.slice(idx).toLowerCase();
}

function classify(name: string): 'image' | 'text' | 'other' {
  const ext = getExt(name);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (TEXT_EXTS.has(ext)) return 'text';
  return 'other';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function FilePreviewPanel({ file, onClose }: Props) {
  const { t } = useI18n();
  const kind = classify(file.name);
  const ext = getExt(file.name).slice(1).toUpperCase() || '—';

  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setImageDataUrl(null);
    setTextContent(null);
    setError(null);
    setLoading(true);

    (async () => {
      try {
        if (kind === 'image') {
          const dataUrl = await getPlatform().invoke<string | null>('get-thumbnail', file.path, 1920);
          setImageDataUrl(dataUrl);
        } else if (kind === 'text') {
          const text = await getPlatform().invoke<string | null>('get-file-text-preview', file.path, 6000);
          setTextContent(text);
        }
      } catch (e: any) {
        setError(e?.message ?? t('filePreview.error'));
      } finally {
        setLoading(false);
      }
    })();
  }, [file.path, kind]);

  return (
    <div className="fixed left-[280px] right-80 top-0 h-full bg-surface border-l border-ink-900/10 shadow-2xl flex flex-col z-40">
      {/* Header */}
      <div className="flex items-center justify-between h-12 px-4 border-b border-ink-900/10 bg-surface-cream flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileIcon kind={kind} />
          <span className="text-sm font-medium text-ink-700 truncate" title={file.name}>
            {file.name}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-ink-500 hover:text-ink-700 hover:bg-ink-100 rounded transition-colors flex-shrink-0"
          aria-label={t('filePreview.close')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Meta bar */}
      <div className="px-4 py-2 bg-ink-50 border-b border-ink-900/10 flex items-center gap-3 text-xs text-ink-500 flex-shrink-0">
        <span className="font-mono bg-ink-200 px-1.5 py-0.5 rounded text-ink-600">{ext}</span>
        {file.size !== undefined && <span>{formatFileSize(file.size)}</span>}
        <button
          onClick={() => getPlatform().send('open-file', file.path)}
          className="ml-auto text-accent hover:underline font-medium"
        >
          {t('filePreview.openExternal')}
        </button>
      </div>

      {/* Content */}
      <div className={`flex-1 min-h-0 ${kind === 'image' ? '' : 'overflow-auto'}`}>
        {loading && (
          <div className="flex items-center justify-center h-32">
            <div className="text-sm text-muted">{t('filePreview.loading')}</div>
          </div>
        )}

        {!loading && error && (
          <div className="flex items-center justify-center h-32 px-6 text-center">
            <div className="text-sm text-ink-500">{error}</div>
          </div>
        )}

        {!loading && !error && kind === 'image' && imageDataUrl && (
          <ImageWithZoom src={imageDataUrl} alt={file.name} />
        )}

        {!loading && !error && kind === 'image' && !imageDataUrl && (
          <div className="flex items-center justify-center h-32">
            <div className="text-sm text-ink-500">{t('filePreview.noPreview')}</div>
          </div>
        )}

        {!loading && !error && kind === 'text' && textContent !== null && (
          <pre className="p-4 text-xs font-mono text-ink-700 whitespace-pre-wrap break-all leading-relaxed">
            {textContent}
          </pre>
        )}

        {!loading && !error && kind === 'other' && (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-ink-400">
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-sm">{t('filePreview.noPreview')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ImageWithZoom({ src, alt }: { src: string; alt: string }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [zoomEnabled, setZoomEnabled] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [zoom, setZoom] = useState(3);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const { t } = useI18n();

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    setCursor({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!zoomEnabled) return;
    e.preventDefault();
    setZoom(z => Math.min(10, Math.max(1, z + (e.deltaY < 0 ? 0.5 : -0.5))));
  }, [zoomEnabled]);

  const showLens = zoomEnabled && hovering;
  const lensSize = 180;
  const imgW = imgRef.current?.offsetWidth ?? 0;
  const imgH = imgRef.current?.offsetHeight ?? 0;

  return (
    <div className="flex flex-col h-full">
      {/* Image area: fills available space, centers the image */}
      <div
        className="flex-1 min-h-0 flex items-center justify-center p-4 overflow-hidden"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onMouseMove={handleMouseMove}
        onWheel={handleWheel}
        style={{ cursor: zoomEnabled ? 'crosshair' : 'default' }}
      >
        <div className="relative inline-block max-w-full max-h-full">
          <img
            ref={imgRef}
            src={src}
            alt={alt}
            className="block max-w-full max-h-full object-contain select-none"
            draggable={false}
            style={{ maxHeight: 'calc(100vh - 160px)' }}
          />
          {showLens && imgW > 0 && (
            <div
              className="absolute rounded-full border-2 border-white/80 shadow-lg pointer-events-none"
              style={{
                width: lensSize,
                height: lensSize,
                left: cursor.x - lensSize / 2,
                top: cursor.y - lensSize / 2,
                backgroundImage: `url(${src})`,
                backgroundRepeat: 'no-repeat',
                backgroundSize: `${imgW * zoom}px ${imgH * zoom}px`,
                backgroundPosition: `${-cursor.x * zoom + lensSize / 2}px ${-cursor.y * zoom + lensSize / 2}px`,
              }}
            />
          )}
        </div>
      </div>
      {/* Zoom toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-ink-900/10 bg-ink-50 flex-shrink-0">
        <button
          onClick={() => setZoomEnabled(v => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
            zoomEnabled
              ? 'bg-accent text-white'
              : 'bg-ink-200 text-ink-600 hover:bg-ink-300'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
          </svg>
          {t('filePreview.zoom') ?? 'Zoom'}
        </button>
        {zoomEnabled && (
          <span className="text-xs text-ink-500">{zoom.toFixed(1)}x</span>
        )}
      </div>
    </div>
  );
}

function FileIcon({ kind }: { kind: 'image' | 'text' | 'other' }) {
  if (kind === 'image') {
    return (
      <svg className="w-4 h-4 text-accent flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }
  if (kind === 'text') {
    return (
      <svg className="w-4 h-4 text-ink-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4 text-ink-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}
