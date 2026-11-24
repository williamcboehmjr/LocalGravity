import React, { useState } from 'react';
import { Sparkles, Download, AlertTriangle, Loader2, X, ExternalLink, CheckCircle2 } from 'lucide-react';
import {
  UpdateInfo,
  downloadAndApplyUpdate,
  isTauriEnvironment,
} from '../../services/updaterService';

interface UpdateNotificationBannerProps {
  updateInfo: UpdateInfo | null;
  onDismiss: () => void;
}

export const UpdateNotificationBanner: React.FC<UpdateNotificationBannerProps> = ({
  updateInfo,
  onDismiss,
}) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressStatus, setProgressStatus] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!updateInfo || !updateInfo.available) {
    return null;
  }

  const isTauri = isTauriEnvironment();

  const handleStartUpdate = async () => {
    setIsUpdating(true);
    setIsFinished(false);
    setErrorMessage(null);

    try {
      await downloadAndApplyUpdate(updateInfo, (progress) => {
        setProgressPercent(progress.percent);
        setProgressStatus(progress.statusText);
        if (progress.status === 'finished') {
          setIsFinished(true);
          setIsUpdating(false);
        }
      });
      setIsUpdating(false);
    } catch (err: any) {
      console.error('[Updater] Download/install error:', err);
      setErrorMessage(err?.message || 'Failed to apply update. Please try again.');
      setIsUpdating(false);
    }
  };

  return (
    <div className="relative z-40 px-4 py-2 bg-[#121316] border-b border-[#2C2D32] text-xs text-text-primary shadow-md animate-in slide-in-from-top-2 duration-200">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Left: Info */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-md bg-accent-blue/15 text-accent-blue shrink-0">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div className="truncate">
            <span className="font-semibold text-text-primary">
              LocalGravity v{updateInfo.version} Available
            </span>
            <span className="text-text-muted ml-2 text-[11px] hidden sm:inline">
              (Current: v{updateInfo.currentVersion || '2.0.0'})
            </span>
            {updateInfo.body && (
              <span className="text-text-muted ml-2 text-[11px] truncate max-w-xs hidden md:inline">
                • {updateInfo.body.split('\n')[0].replace(/^#+\s*/, '')}
              </span>
            )}
          </div>
        </div>

        {/* Right: Actions / Progress */}
        <div className="flex items-center gap-2 shrink-0">
          {isUpdating ? (
            <div className="flex items-center gap-2.5 bg-surface-muted px-3 py-1 rounded-md border border-border-subtle">
              <Loader2 className="w-3.5 h-3.5 text-accent-blue animate-spin shrink-0" />
              <div className="w-24 bg-border-subtle rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-accent-blue h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="text-[11px] font-mono text-text-muted">{progressPercent}%</span>
              <span className="text-[10px] text-text-secondary truncate max-w-[160px]">
                {progressStatus}
              </span>
            </div>
          ) : isFinished ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-300 px-3 py-1 rounded-md border border-emerald-500/30 text-[11px]">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate max-w-[200px]">
                  {progressStatus || 'Update ready'}
                </span>
              </div>
              <button
                type="button"
                onClick={onDismiss}
                title="Dismiss"
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : errorMessage ? (
            <div className="flex items-center gap-1.5 text-rose-400 text-[11px]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{errorMessage}</span>
              <button
                type="button"
                onClick={handleStartUpdate}
                className="underline ml-1 hover:text-rose-300"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              {isTauri ? (
                <button
                  type="button"
                  onClick={handleStartUpdate}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-[#E3E3E3] text-[#101012] hover:bg-white transition-colors shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Update & Restart</span>
                </button>
              ) : (
                <a
                  href={updateInfo.downloadUrl || 'https://github.com/williamcboehmjr/LocalGravity/releases/latest'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/90 transition-colors shadow-xs"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>View Release</span>
                </a>
              )}
              <button
                type="button"
                onClick={onDismiss}
                className="p-1 text-text-muted hover:text-text-primary hover:bg-surface rounded transition-colors"
                title="Dismiss update notification"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
