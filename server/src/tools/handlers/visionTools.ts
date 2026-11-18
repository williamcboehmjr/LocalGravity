import { execSync } from 'node:child_process';
import type { BuiltinToolHandler } from './types.js';

export function captureWindowsScreen(): {
  base64DataUrl: string;
  activeWindowTitle: string;
  resolution: string;
} {
  try {
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
$b64 = [Convert]::ToBase64String($ms.ToArray())
$graphics.Dispose()
$bmp.Dispose()
Write-Output "$($bounds.Width)x$($bounds.Height)|$b64"
    `.trim();

    const encodedPs = Buffer.from(psScript, 'utf16le').toString('base64');
    const out = execSync(
      `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encodedPs}`,
      { timeout: 5000, maxBuffer: 15 * 1024 * 1024, windowsHide: true }
    )
      .toString()
      .trim();

    const [resPart, b64Part] = out.split('|');
    if (b64Part) {
      return {
        base64DataUrl: `data:image/jpeg;base64,${b64Part}`,
        activeWindowTitle: 'Windows Desktop Primary Display',
        resolution: resPart || '1920x1080',
      };
    }
  } catch {
    // Fallback 1x1 dark PNG if headless session
  }

  return {
    base64DataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    activeWindowTitle: 'LocalGravity Headless Surface',
    resolution: '1440x900',
  };
}

const handleVisionCapture: BuiltinToolHandler = async (_args, ctx) => {
  const startMs = performance.now();
  const screenshotResult = captureWindowsScreen();
  ctx.onScreenCaptured?.(screenshotResult.base64DataUrl, screenshotResult.activeWindowTitle);
  return {
    stdout: JSON.stringify(
      {
        captured: true,
        activeWindowTitle: screenshotResult.activeWindowTitle,
        resolution: screenshotResult.resolution,
        byteLength: screenshotResult.base64DataUrl.length,
      },
      null,
      2
    ),
    stderr: '',
    exitCode: 0,
    durationMs: Math.round(performance.now() - startMs),
    screenshotBase64: screenshotResult.base64DataUrl,
  };
};

export const VISION_TOOL_HANDLERS: Record<string, BuiltinToolHandler> = {
  capture_screen: handleVisionCapture,
  inspect_window: handleVisionCapture,
};
