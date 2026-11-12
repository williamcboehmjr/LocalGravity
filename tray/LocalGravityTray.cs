using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace LocalGravityTray
{
    static class Program
    {
        private static Mutex mutex = null;

        [STAThread]
        static void Main()
        {
            try
            {
                string dbg = Path.Combine(Path.GetTempPath(), "tray_debug.log");
                File.AppendAllText(dbg, string.Format("[{0}] Tray Main started\r\n", DateTime.Now));
                const string appName = "LocalGravityTray_SingleInstance_App";
                bool createdNew;
                mutex = new Mutex(true, appName, out createdNew);

                if (!createdNew)
                {
                    File.AppendAllText(dbg, string.Format("[{0}] Mutex already owned. Exiting.\r\n", DateTime.Now));
                    // Already running: open workspace in default browser and exit this instance
                    try
                    {
                        Process.Start(new ProcessStartInfo("http://localhost:3390") { UseShellExecute = true });
                    }
                    catch { }
                    return;
                }

                File.AppendAllText(dbg, string.Format("[{0}] Mutex acquired. Running Application.\r\n", DateTime.Now));
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.ThreadException += delegate(object s, ThreadExceptionEventArgs te) {
                    File.AppendAllText(dbg, string.Format("[ThreadException] {0}\r\n", te.Exception));
                };
                AppDomain.CurrentDomain.UnhandledException += delegate(object s, UnhandledExceptionEventArgs ue) {
                    File.AppendAllText(dbg, string.Format("[UnhandledException] {0}\r\n", ue.ExceptionObject));
                };
                Application.Run(new TrayApplicationContext());
                File.AppendAllText(dbg, string.Format("[{0}] Application.Run returned!\r\n", DateTime.Now));
            }
            catch (Exception ex)
            {
                string dbg = Path.Combine(Path.GetTempPath(), "tray_debug.log");
                File.AppendAllText(dbg, string.Format("[{0}] Main Exception: {1}\r\n", DateTime.Now, ex));
                try
                {
                    string errFile = Path.Combine(Path.GetTempPath(), "LocalGravity_tray_error.log");
                    File.WriteAllText(errFile, ex.ToString());
                    MessageBox.Show(string.Format("LocalGravity Tray Error:\n{0}\n\nDetails saved to: {1}", ex.Message, errFile), "LocalGravity", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                catch { }
            }
        }
    }

    public class TrayApplicationContext : ApplicationContext
    {
        [DllImport("user32.dll", SetLastError = true)]
        static extern bool DestroyIcon(IntPtr hIcon);

        private NotifyIcon trayIcon;
        private ContextMenuStrip contextMenu;
        private System.Windows.Forms.Timer pollTimer;
        private Process brainProcess = null;
        private bool isIntentionalShutdown = false;
        private readonly object logLock = new object();
        private readonly List<string> rollingLogs = new List<string>();
        private const int MaxLogLines = 1500;
        private readonly SynchronizationContext uiContext;

        // Pre-cached static icons (completely prevents GDI/USER handle leaks!)
        private Icon baseAppIcon;
        private Icon iconActive;
        private Icon iconStandby;
        private Icon iconWaking;
        private Icon iconOffline;
        private string currentIconState = "";

        private string repoDir;
        private string localUrl = "http://localhost:3390";
        private string gpuState = "offline"; // "active" | "standby" | "waking" | "offline"
        private int secondsRemaining = 0;
        private int idleTimeoutMinutes = 15;
        private LogViewerForm logViewer = null;

        // Dynamic Menu Items
        private ToolStripMenuItem statusHeaderItem;
        private ToolStripMenuItem gpuStateItem;
        private ToolStripMenuItem offloadGpuItem;
        private ToolStripMenuItem wakeGpuItem;
        private ToolStripMenuItem timerSubmenu;
        private ToolStripMenuItem autoStartItem;

        public TrayApplicationContext()
        {
            string dbg = Path.Combine(Path.GetTempPath(), "tray_debug.log");
            try
            {
                File.AppendAllText(dbg, "[Context] Constructor starting\r\n");
                uiContext = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
                repoDir = ResolveRepoDirectory();
                File.AppendAllText(dbg, string.Format("[Context] repoDir: {0}\r\n", repoDir));

                LoadBaseIconAndPrecacheStatusIcons();
                File.AppendAllText(dbg, "[Context] Icons loaded\r\n");

                InitializeContextMenu();
                File.AppendAllText(dbg, "[Context] ContextMenu initialized\r\n");

                trayIcon = new NotifyIcon
                {
                    Icon = iconOffline,
                    ContextMenuStrip = contextMenu,
                    Visible = true,
                    Text = "LocalGravity 2.0 — Initializing..."
                };

                trayIcon.DoubleClick += delegate(object s, EventArgs e) { OpenWorkspace(); };
                File.AppendAllText(dbg, "[Context] trayIcon created\r\n");

                // Start managed Central Brain process in foreground + headless mode
                StartBrainProcess();
                File.AppendAllText(dbg, "[Context] StartBrainProcess called\r\n");

                // Setup polling timer (every 2 seconds)
                pollTimer = new System.Windows.Forms.Timer { Interval = 2000 };
                pollTimer.Tick += OnPollTick;
                pollTimer.Start();
                File.AppendAllText(dbg, "[Context] Constructor finished successfully\r\n");
            }
            catch (Exception ex)
            {
                File.AppendAllText(dbg, string.Format("[Context ERROR] {0}\r\n", ex));
            }
        }

        private string ResolveRepoDirectory()
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            if (File.Exists(Path.Combine(baseDir, "launch.mjs")))
            {
                return baseDir;
            }

            string parent = Path.GetFullPath(Path.Combine(baseDir, ".."));
            if (File.Exists(Path.Combine(parent, "launch.mjs")))
            {
                return parent;
            }

            string defaultPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                "LocalGravity"
            );
            if (File.Exists(Path.Combine(defaultPath, "launch.mjs")))
            {
                return defaultPath;
            }

            return baseDir;
        }

        private void LoadBaseIconAndPrecacheStatusIcons()
        {
            try
            {
                string iconPath = Path.Combine(repoDir, @"client\src-tauri\icons\icon.ico");
                if (File.Exists(iconPath))
                {
                    baseAppIcon = new Icon(iconPath, SystemInformation.SmallIconSize);
                }
            }
            catch { }

            if (baseAppIcon == null)
            {
                baseAppIcon = SystemIcons.Application;
            }

            // Generate and clone icons ONCE, immediately freeing the unmanaged HICON handles
            iconActive = CreateStatusIconSafe(Color.FromArgb(52, 211, 153));   // Emerald green
            iconStandby = CreateStatusIconSafe(Color.FromArgb(56, 189, 248));  // Sky blue
            iconWaking = CreateStatusIconSafe(Color.FromArgb(251, 191, 36));   // Amber
            iconOffline = CreateStatusIconSafe(Color.FromArgb(248, 113, 113)); // Red
        }

        private Icon CreateStatusIconSafe(Color dotColor)
        {
            try
            {
                int size = Math.Max(16, SystemInformation.SmallIconSize.Width);
                using (Bitmap bmp = new Bitmap(size, size))
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;

                    if (baseAppIcon != null)
                    {
                        g.DrawIcon(baseAppIcon, new Rectangle(0, 0, size, size));
                    }
                    else
                    {
                        using (Brush b = new SolidBrush(Color.FromArgb(30, 31, 34)))
                            g.FillEllipse(b, 1, 1, size - 2, size - 2);
                    }

                    // Dot parameters scaled to native small icon size
                    int dotSize = Math.Max(5, (int)(size * 0.38f));
                    int dotX = size - dotSize - 1;
                    int dotY = size - dotSize - 1;

                    // Black halo border around dot
                    using (Brush halo = new SolidBrush(Color.FromArgb(16, 17, 19)))
                    {
                        g.FillEllipse(halo, dotX - 1, dotY - 1, dotSize + 2, dotSize + 2);
                    }

                    // Colored status dot
                    using (Brush b = new SolidBrush(dotColor))
                    {
                        g.FillEllipse(b, dotX, dotY, dotSize, dotSize);
                    }

                    IntPtr hIcon = bmp.GetHicon();
                    Icon managedIcon;
                    using (Icon temp = Icon.FromHandle(hIcon))
                    {
                        managedIcon = (Icon)temp.Clone();
                    }
                    DestroyIcon(hIcon); // Clean up unmanaged resource immediately!
                    return managedIcon;
                }
            }
            catch
            {
                return baseAppIcon ?? SystemIcons.Application;
            }
        }

        private void InitializeContextMenu()
        {
            string dbg = Path.Combine(Path.GetTempPath(), "tray_debug.log");
            File.AppendAllText(dbg, "[InitMenu] Starting\r\n");
            contextMenu = new ContextMenuStrip();
            contextMenu.Renderer = new DarkMenuRenderer();
            contextMenu.ShowImageMargin = false;
            contextMenu.Opening += OnContextMenuOpening;
            File.AppendAllText(dbg, "[InitMenu] ContextMenuStrip created with renderer\r\n");

            // 1. App Title
            statusHeaderItem = new ToolStripMenuItem("LocalGravity 2.0 (LocalGravity Clone)")
            {
                Enabled = false,
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold)
            };
            contextMenu.Items.Add(statusHeaderItem);
            File.AppendAllText(dbg, "[InitMenu] statusHeaderItem added\r\n");

            // 2. Live Status Badge Item
            gpuStateItem = new ToolStripMenuItem("● Central Brain Offline (Connecting...)")
            {
                Enabled = false,
                Font = new Font("Segoe UI", 9f, FontStyle.Regular)
            };
            contextMenu.Items.Add(gpuStateItem);

            contextMenu.Items.Add(new ToolStripSeparator());

            // 3. Open Workspace
            var openItem = new ToolStripMenuItem("🌐 Open LocalGravity Workspace", null, delegate(object s, EventArgs e) { OpenWorkspace(); })
            {
                Font = new Font("Segoe UI", 9.25f, FontStyle.Bold)
            };
            contextMenu.Items.Add(openItem);

            contextMenu.Items.Add(new ToolStripSeparator());

            // 4. Restart Submenu & Actions
            var restartMenu = new ToolStripMenuItem("🔄 Restart / Reload Engine ▸");
            var restartBrainItem = new ToolStripMenuItem("🔄 Restart Central Brain (Port 3390)", null, delegate(object s, EventArgs e) { RestartCentralBrain(); });
            var restartStrataItem = new ToolStripMenuItem("⚡ Restart Strata Engine (Port 8080)", null, delegate(object s, EventArgs e) { RestartStrataEngine(); });
            var restartAllItem = new ToolStripMenuItem("🔄 Full Reload (Brain + Strata)", null, delegate(object s, EventArgs e) { RestartEverything(); });
            restartMenu.DropDownItems.Add(restartBrainItem);
            restartMenu.DropDownItems.Add(restartStrataItem);
            restartMenu.DropDownItems.Add(new ToolStripSeparator());
            restartMenu.DropDownItems.Add(restartAllItem);
            contextMenu.Items.Add(restartMenu);

            contextMenu.Items.Add(new ToolStripSeparator());

            // 5. GPU Power Controls
            offloadGpuItem = new ToolStripMenuItem("💤 Offload GPU Now (Free 100% VRAM)", null, delegate(object s, EventArgs e) { OffloadGpuManual(); });
            wakeGpuItem = new ToolStripMenuItem("⚡ Wake Strata GPU Engine", null, delegate(object s, EventArgs e) { WakeGpuManual(); });
            contextMenu.Items.Add(offloadGpuItem);
            contextMenu.Items.Add(wakeGpuItem);

            // 6. Auto-Offload Timer Settings
            timerSubmenu = new ToolStripMenuItem("⏱️ Auto-Offload Idle Timer ▸");
            int[] durations = new int[] { 5, 15, 30, 0 };
            foreach (var d in durations)
            {
                int currentD = d;
                string label = currentD == 0 ? "Never (Keep in VRAM)" : string.Format("{0} Minutes", currentD);
                var subItem = new ToolStripMenuItem(label, null, delegate(object s, EventArgs e) { SetIdleTimeout(currentD); });
                subItem.Tag = currentD;
                timerSubmenu.DropDownItems.Add(subItem);
            }
            contextMenu.Items.Add(timerSubmenu);

            // 7. View Live Logs
            var logsItem = new ToolStripMenuItem("📋 View Live Console & Engine Logs...", null, delegate(object s, EventArgs e) { OpenLogViewer(); });
            contextMenu.Items.Add(logsItem);

            contextMenu.Items.Add(new ToolStripSeparator());

            // 8. Start with Windows Checkbox Toggle
            autoStartItem = new ToolStripMenuItem("🚀 Start LocalGravity with Windows", null, delegate(object s, EventArgs e) { ToggleAutoStart(); });
            contextMenu.Items.Add(autoStartItem);

            contextMenu.Items.Add(new ToolStripSeparator());

            // 9. Quit
            var quitItem = new ToolStripMenuItem("❌ Quit LocalGravity Completely", null, delegate(object s, EventArgs e) { QuitApplication(); });
            contextMenu.Items.Add(quitItem);
        }

        private void OnContextMenuOpening(object sender, System.ComponentModel.CancelEventArgs e)
        {
            // Dynamically refresh items before showing
            if (gpuState == "active")
            {
                int m = secondsRemaining / 60;
                int s = secondsRemaining % 60;
                string offloadText = idleTimeoutMinutes > 0
                    ? string.Format("🟢 GPU Active (Swift 1.5 Flash-Next • {0}m {1:D2}s idle left)", m, s)
                    : "🟢 GPU Active (Swift 1.5 Flash-Next • Always in VRAM)";
                gpuStateItem.Text = offloadText;
                offloadGpuItem.Enabled = true;
                offloadGpuItem.Text = "💤 Offload GPU Now (Free 100% VRAM)";
                wakeGpuItem.Enabled = false;
                wakeGpuItem.Text = "⚡ GPU Active & Ready";
            }
            else if (gpuState == "standby")
            {
                gpuStateItem.Text = "🌙 GPU Standby (0 MB VRAM • Wakes on prompt)";
                offloadGpuItem.Enabled = false;
                offloadGpuItem.Text = "💤 GPU Already Offloaded (0 MB VRAM)";
                wakeGpuItem.Enabled = true;
                wakeGpuItem.Text = "⚡ Wake Strata GPU Engine Now";
            }
            else if (gpuState == "waking")
            {
                gpuStateItem.Text = "⚡ Waking Strata GPU Engine (Port 8080)...";
                offloadGpuItem.Enabled = false;
                wakeGpuItem.Enabled = false;
            }
            else
            {
                gpuStateItem.Text = "🔴 Central Brain Offline / Starting...";
                offloadGpuItem.Enabled = false;
                wakeGpuItem.Enabled = false;
            }

            // Update timer checkmarks
            foreach (ToolStripItem item in timerSubmenu.DropDownItems)
            {
                var menuItem = item as ToolStripMenuItem;
                if (menuItem != null && menuItem.Tag is int)
                {
                    int val = (int)menuItem.Tag;
                    menuItem.Checked = (val == idleTimeoutMinutes);
                }
            }

            // Update auto-start checkmark
            autoStartItem.Checked = IsAutoStartEnabled();
        }

        private string ResolveNodeExe()
        {
            string defaultNode = @"C:\Program Files\nodejs\node.exe";
            if (File.Exists(defaultNode)) return defaultNode;
            string appDataNode = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\node\node.exe");
            if (File.Exists(appDataNode)) return appDataNode;
            return "node.exe";
        }

        private void AppendLog(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return;
            string stamped = string.Format("[{0:HH:mm:ss}] {1}", DateTime.Now, text.TrimEnd());
            lock (logLock)
            {
                rollingLogs.Add(stamped);
                if (rollingLogs.Count > MaxLogLines)
                {
                    rollingLogs.RemoveAt(0);
                }

                try
                {
                    string runtimeDir = Path.Combine(repoDir, ".runtime");
                    if (!Directory.Exists(runtimeDir)) Directory.CreateDirectory(runtimeDir);
                    File.AppendAllText(Path.Combine(runtimeDir, "tray.log"), stamped + Environment.NewLine);
                }
                catch { }
            }

            if (logViewer != null && !logViewer.IsDisposed)
            {
                logViewer.AppendLogLine(stamped);
            }
        }

        private void StartBrainProcess()
        {
            try
            {
                AppendLog("[Supervisor] Spawning LocalGravity Central Brain 2.0...");
                string launchScript = Path.Combine(repoDir, "launch.mjs");
                string nodeExe = ResolveNodeExe();

                var psi = new ProcessStartInfo
                {
                    FileName = nodeExe,
                    Arguments = string.Format("\"{0}\" --foreground --headless", launchScript),
                    WorkingDirectory = repoDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8,
                    StandardErrorEncoding = Encoding.UTF8
                };

                brainProcess = new Process { StartInfo = psi, EnableRaisingEvents = true };

                brainProcess.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) {
                    if (e.Data != null) AppendLog(e.Data);
                };

                brainProcess.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) {
                    if (e.Data != null) AppendLog(e.Data);
                };

                brainProcess.Exited += delegate(object s, EventArgs e) {
                    int exitCode = 0;
                    try { exitCode = brainProcess.ExitCode; } catch { }

                    AppendLog(string.Format("[Supervisor] Central Brain process exited with code {0}.", exitCode));

                    if (isIntentionalShutdown)
                    {
                        return;
                    }

                    if (exitCode == 42)
                    {
                        // Code 42: Self-restart triggered from chat or supervisor!
                        AppendLog("[Supervisor] Central Brain requested self-restart (code 42). Rebooting in 500ms...");
                        ShowNotification("LocalGravity", "Central Brain is reloading with updated code...");
                        Thread.Sleep(500);
                        StartBrainProcess();
                    }
                    else
                    {
                        // Unexpected termination: auto-recover after 2 seconds
                        AppendLog("[Supervisor] Central Brain terminated unexpectedly. Auto-recovering in 2s...");
                        Thread.Sleep(2000);
                        StartBrainProcess();
                    }
                };

                brainProcess.Start();
                brainProcess.BeginOutputReadLine();
                brainProcess.BeginErrorReadLine();
                AppendLog(string.Format("[Supervisor] Central Brain started (PID: {0}).", brainProcess.Id));
            }
            catch (Exception ex)
            {
                AppendLog(string.Format("[Supervisor ERROR] Failed to spawn Central Brain: {0}", ex.Message));
            }
        }

        private void OnPollTick(object sender, EventArgs e)
        {
            ThreadPool.QueueUserWorkItem(delegate(object state)
            {
                try
                {
                    var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:3390/api/gpu/status");
                    req.Timeout = 1400;
                    req.Method = "GET";

                    using (var resp = req.GetResponse())
                    using (var reader = new StreamReader(resp.GetResponseStream()))
                    {
                        string json = reader.ReadToEnd();
                        ParseStatusAndUpdateUi(json);
                    }
                }
                catch
                {
                    UpdateTrayState("offline", 0, 15);
                }
            });
        }

        private void ParseStatusAndUpdateUi(string json)
        {
            var stateMatch = Regex.Match(json, "\"gpuState\"\\s*:\\s*\"([^\"]+)\"");
            var secMatch = Regex.Match(json, "\"secondsRemaining\"\\s*:\\s*(\\d+)");
            var timeoutMatch = Regex.Match(json, "\"idleTimeoutMinutes\"\\s*:\\s*(\\d+)");

            string state = stateMatch.Success ? stateMatch.Groups[1].Value : "standby";
            int sec = secMatch.Success ? int.Parse(secMatch.Groups[1].Value) : 0;
            int timeout = timeoutMatch.Success ? int.Parse(timeoutMatch.Groups[1].Value) : 15;

            UpdateTrayState(state, sec, timeout);
        }

        private void UpdateTrayState(string state, int sec, int timeout)
        {
            if (uiContext != null)
            {
                uiContext.Post(delegate
                {
                    ApplyTrayState(state, sec, timeout);
                }, null);
            }
            else
            {
                ApplyTrayState(state, sec, timeout);
            }
        }

        private void ApplyTrayState(string state, int sec, int timeout)
        {
            gpuState = state;
            secondsRemaining = sec;
            idleTimeoutMinutes = timeout;

            string tooltipText;

            if (state == "active")
            {
                if (timeout > 0 && sec > 0)
                {
                    int m = sec / 60;
                    int s = sec % 60;
                    tooltipText = string.Format("LocalGravity — GPU Active ({0}m {1:D2}s left)", m, s);
                }
                else
                {
                    tooltipText = "LocalGravity — GPU Active (Swift 1.5 Flash-Next)";
                }
            }
            else if (state == "standby")
            {
                tooltipText = "LocalGravity — Standby (0 MB VRAM • Auto-wakes)";
            }
            else if (state == "waking")
            {
                tooltipText = "LocalGravity — ⚡ Waking Strata Engine...";
            }
            else
            {
                tooltipText = "LocalGravity — Brain Offline / Connecting...";
            }

            if (trayIcon != null)
            {
                try
                {
                    // Truncate tooltip safely to 63 chars max
                    trayIcon.Text = tooltipText.Length > 63 ? tooltipText.Substring(0, 60) + "..." : tooltipText;

                    // Switch icon reference ONLY when state changes (zero GDI allocations!)
                    if (currentIconState != state)
                    {
                        currentIconState = state;
                        if (state == "active") trayIcon.Icon = iconActive;
                        else if (state == "standby") trayIcon.Icon = iconStandby;
                        else if (state == "waking") trayIcon.Icon = iconWaking;
                        else trayIcon.Icon = iconOffline;
                    }
                }
                catch { }
            }
        }

        private void OpenWorkspace()
        {
            try
            {
                Process.Start(new ProcessStartInfo(localUrl) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                MessageBox.Show(string.Format("Failed to open workspace: {0}", ex.Message), "LocalGravity", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        public void RestartCentralBrain()
        {
            AppendLog("[Supervisor] Restart Central Brain requested.");
            ShowNotification("LocalGravity", "Restarting Central Brain...");

            ThreadPool.QueueUserWorkItem(delegate(object s)
            {
                // Attempt graceful restart API
                PostApiDirect("http://127.0.0.1:3390/api/system/restart", "{}");

                // Wait up to 1200ms for graceful exit
                for (int i = 0; i < 12; i++)
                {
                    Thread.Sleep(100);
                    if (brainProcess == null || brainProcess.HasExited) break;
                }

                // If still running or frozen, forcefully terminate
                if (brainProcess != null && !brainProcess.HasExited)
                {
                    AppendLog("[Supervisor] Graceful restart timed out. Force-terminating Brain process tree...");
                    KillProcessTree(brainProcess.Id);
                }

                FreePort(3390);
                Thread.Sleep(300);
                StartBrainProcess();
            });
        }

        public void RestartStrataEngine()
        {
            AppendLog("[Supervisor] Restart Strata GPU Engine requested.");
            ShowNotification("LocalGravity", "Restarting Strata GPU Engine on port 8080...");

            ThreadPool.QueueUserWorkItem(delegate(object s)
            {
                PostApiDirect("http://127.0.0.1:3390/api/gpu/offload", "{}");
                Thread.Sleep(800);
                FreePort(8080);
                Thread.Sleep(400);
                PostApiDirect("http://127.0.0.1:3390/api/gpu/wake", "{}");
            });
        }

        public void RestartEverything()
        {
            AppendLog("[Supervisor] Full System Reload requested.");
            ShowNotification("LocalGravity", "Full Reload: Recycling Central Brain and Strata GPU Engine...");

            ThreadPool.QueueUserWorkItem(delegate(object s)
            {
                if (brainProcess != null && !brainProcess.HasExited)
                {
                    KillProcessTree(brainProcess.Id);
                }
                FreePort(3390);
                FreePort(8080);
                Thread.Sleep(500);
                StartBrainProcess();
            });
        }

        public void OffloadGpuManual()
        {
            AppendLog("[Tray] Manual GPU offload requested.");
            ShowNotification("LocalGravity", "Offloading GPU VRAM (Standby mode)...");
            PostApi("http://127.0.0.1:3390/api/gpu/offload", "{}");
        }

        public void WakeGpuManual()
        {
            AppendLog("[Tray] Manual GPU wake requested.");
            ShowNotification("LocalGravity", "Waking Strata GPU Engine (Swift 1.5 Flash-Next)...");
            PostApi("http://127.0.0.1:3390/api/gpu/wake", "{}");
        }

        public void SetIdleTimeout(int minutes)
        {
            AppendLog(string.Format("[Tray] Setting auto-offload timer to {0} minutes.", minutes));
            idleTimeoutMinutes = minutes;
            PostApi("http://127.0.0.1:3390/api/gpu/timeout", string.Format("{{\"minutes\":{0}}}", minutes));
            string notice = minutes == 0 ? "Auto-offload disabled (GPU always active)." : string.Format("Auto-offload set to {0} minutes.", minutes);
            ShowNotification("LocalGravity Settings", notice);
        }

        private void PostApi(string url, string jsonBody)
        {
            ThreadPool.QueueUserWorkItem(delegate(object state)
            {
                PostApiDirect(url, jsonBody);
            });
        }

        private void PostApiDirect(string url, string jsonBody)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = "POST";
                req.ContentType = "application/json";
                req.Timeout = 4000;
                byte[] bytes = Encoding.UTF8.GetBytes(jsonBody);
                req.ContentLength = bytes.Length;
                using (var stream = req.GetRequestStream())
                {
                    stream.Write(bytes, 0, bytes.Length);
                }
                using (var resp = req.GetResponse()) { }
            }
            catch (Exception ex)
            {
                AppendLog(string.Format("[Tray API Error] {0}: {1}", url, ex.Message));
            }
        }

        private void ShowNotification(string title, string message)
        {
            if (trayIcon != null)
            {
                try
                {
                    trayIcon.ShowBalloonTip(2000, title, message, ToolTipIcon.Info);
                }
                catch { }
            }
        }

        private void KillProcessTree(int pid)
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "taskkill.exe",
                    Arguments = string.Format("/F /T /PID {0}", pid),
                    CreateNoWindow = true,
                    UseShellExecute = false
                };
                var proc = Process.Start(psi);
                if (proc != null) proc.WaitForExit(1500);
            }
            catch { }
        }

        private void FreePort(int port)
        {
            // Never touch forbidden ports 5000 / 5001
            if (port == 5000 || port == 5001) return;

            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "netstat.exe",
                    Arguments = "-ano",
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using (var p = Process.Start(psi))
                {
                    string outText = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(1000);
                    string portPattern = ":" + port + @"\s+.*LISTENING\s+(\d+)";
                    foreach (Match m in Regex.Matches(outText, portPattern, RegexOptions.IgnoreCase))
                    {
                        int pid;
                        if (int.TryParse(m.Groups[1].Value, out pid) && pid > 4 && pid != Process.GetCurrentProcess().Id)
                        {
                            try { KillProcessTree(pid); } catch { }
                        }
                    }
                }
            }
            catch { }
        }

        private bool IsAutoStartEnabled()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", false))
                {
                    if (key != null)
                    {
                        return key.GetValue("LocalGravityTray") != null;
                    }
                }
            }
            catch { }
            return false;
        }

        private void ToggleAutoStart()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                {
                    if (key != null)
                    {
                        if (IsAutoStartEnabled())
                        {
                            key.DeleteValue("LocalGravityTray", false);
                            ShowNotification("LocalGravity", "Removed from Windows startup.");
                        }
                        else
                        {
                            string exePath = Application.ExecutablePath;
                            key.SetValue("LocalGravityTray", string.Format("\"{0}\"", exePath));
                            ShowNotification("LocalGravity", "Configured to start quietly in system tray on Windows boot.");
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(string.Format("Failed to toggle Windows auto-start: {0}", ex.Message), "LocalGravity", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void OpenLogViewer()
        {
            if (logViewer == null || logViewer.IsDisposed)
            {
                List<string> snapshot;
                lock (logLock)
                {
                    snapshot = new List<string>(rollingLogs);
                }
                logViewer = new LogViewerForm(snapshot, baseAppIcon, delegate { RestartCentralBrain(); });
                logViewer.FormClosed += delegate(object s, FormClosedEventArgs e) { logViewer = null; };
                logViewer.Show();
            }
            else
            {
                logViewer.BringToFront();
            }
        }

        private void QuitApplication()
        {
            isIntentionalShutdown = true;
            if (pollTimer != null) pollTimer.Stop();

            if (trayIcon != null)
            {
                trayIcon.Visible = false;
            }

            AppendLog("[Supervisor] Shutting down LocalGravity completely...");

            // Send shutdown to brain (which offloads GPU VRAM cleanly)
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:3390/api/system/shutdown");
                req.Method = "POST";
                req.Timeout = 1200;
                req.ContentLength = 0;
                using (var resp = req.GetResponse()) { }
            }
            catch { }

            Thread.Sleep(300);

            // Clean up child brain process tree if still running
            if (brainProcess != null && !brainProcess.HasExited)
            {
                KillProcessTree(brainProcess.Id);
            }

            // Ensure ports 3390 and 8080 are released
            FreePort(3390);
            FreePort(8080);

            Application.Exit();
        }
    }

    public class LogViewerForm : Form
    {
        private TextBox txtLogs;
        private Button btnCopy;
        private Button btnClear;
        private Button btnRestart;

        public LogViewerForm(List<string> initialLogs, Icon icon, Action onRestart)
        {
            Text = "LocalGravity 2.0 — Live Console & Engine Logs";
            Width = 880;
            Height = 560;
            BackColor = Color.FromArgb(18, 19, 22);
            ForeColor = Color.FromArgb(232, 234, 237);
            Font = new Font("Segoe UI", 9f);
            StartPosition = FormStartPosition.CenterScreen;
            if (icon != null) Icon = icon;

            var panelTop = new Panel
            {
                Dock = DockStyle.Top,
                Height = 42,
                BackColor = Color.FromArgb(24, 25, 29),
                Padding = new Padding(8, 6, 8, 6)
            };

            btnCopy = new Button
            {
                Text = "📋 Copy All",
                Location = new Point(10, 7),
                Size = new Size(95, 27),
                FlatStyle = FlatStyle.Flat,
                ForeColor = Color.FromArgb(232, 234, 237),
                BackColor = Color.FromArgb(38, 40, 46),
                Cursor = Cursors.Hand
            };
            btnCopy.FlatAppearance.BorderColor = Color.FromArgb(50, 54, 62);
            btnCopy.Click += delegate(object s, EventArgs e) {
                if (!string.IsNullOrEmpty(txtLogs.Text))
                    Clipboard.SetText(txtLogs.Text);
            };

            btnClear = new Button
            {
                Text = "🧹 Clear View",
                Location = new Point(115, 7),
                Size = new Size(100, 27),
                FlatStyle = FlatStyle.Flat,
                ForeColor = Color.FromArgb(160, 165, 175),
                BackColor = Color.FromArgb(38, 40, 46),
                Cursor = Cursors.Hand
            };
            btnClear.FlatAppearance.BorderColor = Color.FromArgb(50, 54, 62);
            btnClear.Click += delegate(object s, EventArgs e) { txtLogs.Clear(); };

            btnRestart = new Button
            {
                Text = "🔄 Restart Brain",
                Location = new Point(225, 7),
                Size = new Size(110, 27),
                FlatStyle = FlatStyle.Flat,
                ForeColor = Color.FromArgb(138, 180, 248),
                BackColor = Color.FromArgb(38, 40, 46),
                Cursor = Cursors.Hand
            };
            btnRestart.FlatAppearance.BorderColor = Color.FromArgb(50, 54, 62);
            btnRestart.Click += delegate(object s, EventArgs e) {
                if (onRestart != null) onRestart();
            };

            panelTop.Controls.Add(btnCopy);
            panelTop.Controls.Add(btnClear);
            panelTop.Controls.Add(btnRestart);

            txtLogs = new TextBox
            {
                Dock = DockStyle.Fill,
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Both,
                BackColor = Color.FromArgb(12, 13, 15),
                ForeColor = Color.FromArgb(215, 220, 225),
                Font = new Font("Consolas", 9.5f),
                WordWrap = false
            };

            if (initialLogs != null && initialLogs.Count > 0)
            {
                txtLogs.Text = string.Join(Environment.NewLine, initialLogs.ToArray()) + Environment.NewLine;
                txtLogs.SelectionStart = txtLogs.Text.Length;
                txtLogs.ScrollToCaret();
            }

            Controls.Add(txtLogs);
            Controls.Add(panelTop);
        }

        public void AppendLogLine(string line)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action<string>(AppendLogLine), line);
                return;
            }
            if (txtLogs != null && !txtLogs.IsDisposed)
            {
                txtLogs.AppendText(line + Environment.NewLine);
            }
        }
    }

    public class DarkMenuRenderer : ToolStripProfessionalRenderer
    {
        public DarkMenuRenderer() : base(new DarkColorTable()) { }

        protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
        {
            if (e.Item is ToolStripMenuItem)
            {
                if (!e.Item.Enabled)
                {
                    e.TextColor = Color.FromArgb(120, 125, 135);
                }
                else if (e.Item.Selected)
                {
                    e.TextColor = Color.FromArgb(255, 255, 255);
                }
                else
                {
                    e.TextColor = Color.FromArgb(232, 234, 237);
                }
            }
            base.OnRenderItemText(e);
        }
    }

    public class DarkColorTable : ProfessionalColorTable
    {
        public override Color MenuBorder { get { return Color.FromArgb(50, 54, 62); } }
        public override Color ToolStripDropDownBackground { get { return Color.FromArgb(26, 27, 31); } }
        public override Color MenuItemSelected { get { return Color.FromArgb(42, 45, 52); } }
        public override Color MenuItemBorder { get { return Color.FromArgb(68, 72, 82); } }
        public override Color SeparatorDark { get { return Color.FromArgb(40, 42, 48); } }
        public override Color SeparatorLight { get { return Color.FromArgb(40, 42, 48); } }
        public override Color MenuItemSelectedGradientBegin { get { return Color.FromArgb(42, 45, 52); } }
        public override Color MenuItemSelectedGradientEnd { get { return Color.FromArgb(42, 45, 52); } }
        public override Color MenuItemPressedGradientBegin { get { return Color.FromArgb(34, 36, 42); } }
        public override Color MenuItemPressedGradientEnd { get { return Color.FromArgb(34, 36, 42); } }
    }
}
