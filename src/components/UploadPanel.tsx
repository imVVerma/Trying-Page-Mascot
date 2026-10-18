import { useRef, type RefObject } from 'react';
import { Upload, Sparkles, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import type { ValidationReport } from '../utils/photoValidator';

interface UploadPanelProps {
  fileInputRef: RefObject<HTMLInputElement | null>;
  report: ValidationReport | null;
  isValidating: boolean;
  isGenerating: boolean;
  statusText: string;
  error: string | null;
  onFileSelect: (file: File) => void;
  onGenerate: () => void;
}

export function UploadPanel({
  fileInputRef,
  report,
  isValidating,
  isGenerating,
  statusText,
  error,
  onFileSelect,
  onGenerate,
}: UploadPanelProps) {
  const dragDepth = useRef(0);

  const canGenerate = Boolean(report?.isValid) && !isGenerating;

  return (
    <>
      <div
        className="dropzone"
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current += 1;
          e.currentTarget.classList.add('dragging');
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) e.currentTarget.classList.remove('dragging');
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          e.currentTarget.classList.remove('dragging');
          const file = e.dataTransfer.files?.[0];
          if (file) onFileSelect(file);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        aria-label="Upload a photo"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFileSelect(file);
            // Reset so re-selecting the same file fires onChange again.
            e.target.value = '';
          }}
        />

        {isValidating ? (
          <Loader2 size={28} className="spin" />
        ) : (
          <Upload size={28} />
        )}

        <strong>
          {isValidating
            ? 'Checking your photo…'
            : 'Drop a photo here, or click to choose'}
        </strong>
        <span className="dropzone-hint">
          One person, facing the camera, well lit. JPG, PNG or WebP.
        </span>
      </div>

      {report && (
        <div className="report">
          <div className="report-head">
            <span className={report.isValid ? 'score ok' : 'score warn'}>
              {report.isValid ? 'Looks good' : 'Needs a better photo'}
            </span>
          </div>

          <ul className="report-list">
            {report.checks.map((check) => (
              <li key={check.id} className={check.passed ? 'pass' : 'fail'}>
                {check.passed ? (
                  <CheckCircle2 size={15} />
                ) : (
                  <AlertTriangle size={15} />
                )}
                <span className="report-name">{check.name}</span>
                <span className="report-msg">{check.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="banner error">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      <button
        type="button"
        className="primary-button"
        disabled={!canGenerate}
        onClick={onGenerate}
      >
        {isGenerating ? (
          <>
            <Loader2 size={17} className="spin" />
            <span>{statusText || 'Generating…'}</span>
          </>
        ) : (
          <>
            <Sparkles size={17} />
            <span>Generate my mascot</span>
          </>
        )}
      </button>
    </>
  );
}
