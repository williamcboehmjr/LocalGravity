import { check, Update, DownloadEvent } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export interface UpdateInfo {
  available: boolean;
  version?: string;
  currentVersion?: string;
  body?: string;
  date?: string;
  updateHandle?: Update | null;
  downloadUrl?: string;
}

export type UpdateProgressCallback = (progress: {
  status: 'started' | 'downloading' | 'finished' | 'relaunching';
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  statusText: string;
}) => void;

/**
 * Checks whether the current window is running inside the Tauri native container
 */
export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Checks GitHub / Tauri endpoints for available LocalGravity updates
 */
export async function checkForAppUpdates(): Promise<UpdateInfo> {
  const isTauri = isTauriEnvironment();

  if (isTauri) {
    try {
      const update = await check({
        timeout: 10000,
      });

      if (update) {
        return {
          available: true,
          version: update.version,
          currentVersion: update.currentVersion,
          body: update.body || '',
          date: update.date,
          updateHandle: update,
        };
      }

      return {
        available: false,
        currentVersion: '2.0.0',
      };
    } catch (err: any) {
      console.warn('[Updater] Tauri native check failed or offline:', err);
      // Fallback to checking GitHub API directly if Tauri endpoint fails
    }
  }

  // Fallback for Web Companion / Browser
  try {
    const res = await fetch('https://api.github.com/repos/williamcboehmjr/LocalGravity/releases/latest', {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (!res.ok) {
      return { available: false, currentVersion: '2.0.0' };
    }

    const data = await res.json();
    const latestTag = data.tag_name?.replace(/^v/, '') || '';
    const currentVersion = '2.0.0';

    const isNewer = compareSemver(latestTag, currentVersion) > 0;

    return {
      available: isNewer,
      version: latestTag,
      currentVersion,
      body: data.body || '',
      date: data.published_at,
      downloadUrl: data.html_url,
    };
  } catch (webErr) {
    console.warn('[Updater] Web GitHub release check failed:', webErr);
    return { available: false, currentVersion: '2.0.0' };
  }
}

/**
 * Downloads and applies the update, then prompts or relaunches the application
 */
export async function downloadAndApplyUpdate(
  updateHandle: Update,
  onProgress?: UpdateProgressCallback
): Promise<void> {
  let total = 0;
  let downloaded = 0;

  await updateHandle.downloadAndInstall((event: DownloadEvent) => {
    if (event.event === 'Started') {
      total = event.data.contentLength ?? 0;
      onProgress?.({
        status: 'started',
        downloadedBytes: 0,
        totalBytes: total,
        percent: 0,
        statusText: `Starting download (${total ? formatBytes(total) : 'calculating size'})...`,
      });
    } else if (event.event === 'Progress') {
      downloaded += event.data.chunkLength;
      const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
      onProgress?.({
        status: 'downloading',
        downloadedBytes: downloaded,
        totalBytes: total,
        percent: pct,
        statusText: `Downloading: ${pct}% (${formatBytes(downloaded)} / ${formatBytes(total)})`,
      });
    } else if (event.event === 'Finished') {
      onProgress?.({
        status: 'finished',
        downloadedBytes: downloaded,
        totalBytes: total,
        percent: 100,
        statusText: 'Download complete. Applying update & relaunching...',
      });
    }
  });

  onProgress?.({
    status: 'relaunching',
    downloadedBytes: downloaded,
    totalBytes: total,
    percent: 100,
    statusText: 'Relaunching LocalGravity...',
  });

  // Short pause to ensure disk flush, then relaunch
  try {
    await relaunch();
  } catch {
    // On some Windows targets, installer handles relaunch directly
  }
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function compareSemver(v1: string, v2: string): number {
  const p1 = v1.split('.').map(Number);
  const p2 = v2.split('.').map(Number);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}
