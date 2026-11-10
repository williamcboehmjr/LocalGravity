import { check, Update, DownloadEvent } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { useSessionStore } from '../store/useSessionStore';

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
 * Checks Brain proxy & GitHub / Tauri endpoints for available LocalGravity updates
 */
export async function checkForAppUpdates(): Promise<UpdateInfo> {
  const isTauri = isTauriEnvironment();
  let currentVersion = '2.2.5';
  if (isTauri) {
    try {
      currentVersion = await getVersion();
    } catch {}
  }

  // 1. Primary Check on Desktop: Native Tauri Updater (provides signed updateHandle for direct downloadAndInstall)
  // Note: On macOS, Tauri v2 updater requires tar.gz bundles. If release uses DMG, native check may return an update
  // whose downloadAndInstall fails because it is a DMG disk image. We extract downloadUrl from rawJson.
  if (isTauri) {
    try {
      const update = await check({
        timeout: 10000,
      });

      if (update) {
        const isMac =
          typeof navigator !== 'undefined' &&
          /mac|darwin|iphone|ipad/i.test(navigator.userAgent || navigator.platform || '');
        
        let macDmgUrl: string | undefined;
        if (isMac && update.rawJson) {
          const platforms = (update.rawJson as any).platforms;
          macDmgUrl = platforms?.['darwin-aarch64']?.url;
        }

        return {
          available: true,
          version: update.version.replace(/^v/, ''),
          currentVersion: update.currentVersion,
          body: update.body || '',
          date: update.date,
          updateHandle: update,
          downloadUrl: macDmgUrl,
        };
      }
    } catch (err: any) {
      console.warn('[Updater] Tauri native check failed, falling back to Central Brain:', err);
    }
  }

  // 2. Secondary Check: Query Central Brain's authenticated updater endpoint (works seamlessly over LAN)
  try {
    const apiBaseUrl = useSessionStore.getState().apiBaseUrl || 'http://127.0.0.1:3390';
    const brainRes = await fetch(`${apiBaseUrl}/api/updater/latest.json`, {
      signal: AbortSignal.timeout(4000),
      headers: { Accept: 'application/json' },
    });
    if (brainRes.ok) {
      const manifest = await brainRes.json();
      const latestTag = manifest.version?.replace(/^v/, '') || '';
      const isNewer = compareSemver(latestTag, currentVersion) > 0;
      if (isNewer) {
        const isMac =
          typeof navigator !== 'undefined' &&
          /mac|darwin|iphone|ipad/i.test(navigator.userAgent || navigator.platform || '');
        const platformKey = isMac ? 'darwin-aarch64' : 'windows-x86_64';
        const platform = manifest.platforms?.[platformKey];
        return {
          available: true,
          version: latestTag,
          currentVersion,
          body: manifest.notes || '',
          date: manifest.pub_date,
          downloadUrl:
            platform?.url ||
            `${apiBaseUrl}/api/updater/download/${isMac ? `LocalGravity_${latestTag}_aarch64.dmg` : `LocalGravity_${latestTag}_x64_en-US.msi`}`,
        };
      }
    }
  } catch (brainErr) {
    console.warn('[Updater] Central Brain updater check failed, falling back to web:', brainErr);
  }

  // 3. Fallback for Web Companion / Browser
  try {
    const res = await fetch('https://api.github.com/repos/williamcboehmjr/LocalGravity/releases/latest', {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (res.ok) {
      const data = await res.json();
      const latestTag = data.tag_name?.replace(/^v/, '') || '';
      const isNewer = compareSemver(latestTag, currentVersion) > 0;

      return {
        available: isNewer,
        version: latestTag,
        currentVersion,
        body: data.body || '',
        date: data.published_at,
        downloadUrl: data.html_url,
      };
    }
  } catch (webErr) {
    console.warn('[Updater] Web GitHub release check failed:', webErr);
  }

  return { available: false, currentVersion };
}

/**
 * Downloads and applies the update, then prompts or relaunches the application.
 * Supports native Tauri updates (Windows MSI / macOS tar.gz) and native macOS DMG pipeline.
 */
export async function downloadAndApplyUpdate(
  updateInfoOrHandle: Update | UpdateInfo,
  onProgress?: UpdateProgressCallback
): Promise<void> {
  const isTauri = isTauriEnvironment();
  const isMac =
    typeof navigator !== 'undefined' &&
    /mac|darwin|iphone|ipad/i.test(navigator.userAgent || navigator.platform || '');

  // Extract updateHandle and downloadUrl
  const updateHandle =
    'updateHandle' in updateInfoOrHandle
      ? updateInfoOrHandle.updateHandle
      : (updateInfoOrHandle as Update);

  const downloadUrl =
    'downloadUrl' in updateInfoOrHandle ? updateInfoOrHandle.downloadUrl : undefined;

  // On macOS Desktop, if we have a direct DMG download URL, execute the native DMG installer
  if (isTauri && isMac && downloadUrl) {
    onProgress?.({
      status: 'started',
      downloadedBytes: 0,
      totalBytes: 5735749,
      percent: 10,
      statusText: 'Downloading macOS update image...',
    });

    onProgress?.({
      status: 'downloading',
      downloadedBytes: 2500000,
      totalBytes: 5735749,
      percent: 50,
      statusText: 'Downloading update from GitHub...',
    });

    try {
      await invoke('install_dmg_update', { dmgUrl: downloadUrl });
      return;
    } catch (dmgErr: any) {
      console.warn('[Updater] Native DMG installer failed, falling back to updater plugin:', dmgErr);
    }
  }

  if (!updateHandle) {
    if (isTauri && !isMac && downloadUrl) {
      onProgress?.({
        status: 'downloading',
        downloadedBytes: 2500000,
        totalBytes: 5800000,
        percent: 50,
        statusText: 'Downloading & installing Windows MSI update...',
      });
      await invoke('install_msi_update', { msiUrl: downloadUrl });
      return;
    }
    if (downloadUrl) {
      window.open(downloadUrl, '_blank');
      return;
    }
    throw new Error('No update handle or download URL available to apply update.');
  }

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
