using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace LocalGravityTray
{
    static class Program
    {
        private static Mutex mutex = null;

        [STAThread]
        static void Main()
        {
            const string appName = "LocalGravityTray_SingleInstance_App";
            bool createdNew;
            mutex = new Mutex(true, appName, out createdNew);

            if (!createdNew)
            {
                // Already running: open workspace in default browser and exit this instance
                try
                {
                    Process.Start(new ProcessStartInfo("http://localhost:3390") { UseShellExecute = true });
                }
                catch { }
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new TrayApplicationContext());
        }
    }

    public class TrayApplicationContext : ApplicationContext
    {
        private NotifyIcon trayIcon;
        private ContextMenuStrip contextMenu;
        private System.Windows.Forms.Timer pollTimer;
        private Process brainProcess = null;
        private bool isIntentionalShutdown = false;
        private readonly object logLock = new object();
        private readonly List<string> rollingLogs = new List<string>();
        private const int MaxLogLines = 1200;

        private Icon baseAppIcon;
        private string repoDir;
        private string localUrl = "http://localhost:3390";
        private string gpuState = "standby"; // "active" | "standby" | "waking" | "offline"
        private int secondsRemaining = 0;
        private int idleTimeoutMinutes = 15;
        private LogViewerForm logViewer = null;

        public TrayApplicationContext()
        {
            repoDir = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
            if (!File.Exists(Path.Combine(repoDir, "launch.mjs")))
            {
                // If running from repo root
                if (File.Exists(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "launch.mjs")))
                {
                    repoDir = AppDomain.CurrentDomain.BaseDirectory;
                }
                else
                {
                    repoDir = @"C:\Users\Sue\.gemini\antigravity\scratch\LocalGravity";
                }
            }

            LoadBaseIcon();
            InitializeContextMenu();

            trayIcon = new NotifyIcon
            {
                Icon = CreateStatusIcon(Color.FromArgb(251, 191, 36)), // Start with amber (starting)
                ContextMenuStrip = contextMenu,
                Visible = true,
                Text = "LocalGravity 2.0 — Initializing Central Brain..."
            };

            trayIcon.DoubleClick += delegate(object s, EventArgs e) { OpenWorkspace(); };

            // Start managed Central Brain process with watchdog supervision
            StartBrainProcess();

            // Setup polling timer (every 2 seconds)
            pollTimer = new System.Windows.Forms.Timer { Interval = 2000 };
            pollTimer.Tick += OnPollTick;
            pollTimer.Start();
        }

        private void LoadBaseIcon()
        {
            try
            {
                string iconPath = Path.Combine(repoDir, @"client\src-tauri\icons\icon.ico");
                if (File.Exists(iconPath))
                {
                    baseAppIcon = new Icon(iconPath, new Size(32, 32));
                    return;
                }
            }
            catch { }
            baseAppIcon = SystemIcons.Application;
        }

        private Icon CreateStatusIcon(Color dotColor)
        {
            try
            {
                using (Bitmap bmp = new Bitmap(32, 32))
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;

                    if (baseAppIcon != null)
                    {
                        g.DrawIcon(baseAppIcon, new Rectangle(0, 0, 32, 32));
                    }
                    else
                    {
                        using (Brush b = new SolidBrush(Color.FromArgb(30, 31, 34)))
                            g.FillEllipse(b, 2, 2, 28, 28);
                    }

                    // Draw status badge dot at bottom-right corner
                    int dotX = 20;
                    int dotY = 20;
                    int dotSize = 10;

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
                    return Icon.FromHandle(hIcon);
                }
            }
            catch
            {
                return baseAppIcon ?? SystemIcons.Application;
            }
        }

        private void InitializeContextMenu()
        {
            contextMenu = new ContextMenuStrip();
            contextMenu.Renderer = new DarkMenuRenderer();
            contextMenu.ShowImageMargin = false;

            // 1. Title / Header
            var titleItem = new ToolStripMenuItem("LocalGravity 2.0 (Fastify + Strata)")
            {
                Enabled = false,
                Font = new Font("Segoe UI", 9.25f, FontStyle.Bold)
            };
            contextMenu.Items.Add(titleItem);

            // 2. Open Workspace
            var openItem = new ToolStripMenuItem("🌐 Open LocalGravity Workspace", null, delegate(object s, EventArgs e) { OpenWorkspace(); })
            {
                Font = new Font("Segoe UI", 9f, FontStyle.Bold)
            };
            contextMenu.Items.Add(openItem);

            contextMenu.Items.Add(new ToolStripSeparator());

            // 3. Restart Submenu / Items
            var restartBrainItem = new ToolStripMenuItem("🔄 Restart Central Brain", null, delegate(object s, EventArgs e) { RestartCentralBrain(); });
            var restartStrataItem = new ToolStripMenuItem("⚡ Restart Strata GPU Engine", null, delegate(object s, EventArgs e) { RestartStrataEngine(); });
            var restartAllItem = new ToolStripMenuItem("🔄 Restart Everything (Full Reload)", null, delegate(object s, EventArgs e) { RestartEverything(); });
            contextMenu.Items.Add(restartBrainItem);
            contextMenu.Items.Add(restartStrataItem);
            contextMenu.Items.Add(restartAllItem);

            contextMenu.Items.Add(new ToolStripSeparator());

            // 4. GPU Power Management
            var offloadGpuItem = new ToolStripMenuItem("💤 Offload GPU Now (Free 100% VRAM)", null, delegate(object s, EventArgs e) { OffloadGpuManual(); });
            var wakeGpuItem = new ToolStripMenuItem("⚡ Wake GPU Engine Now", null, delegate(object s, EventArgs e) { WakeGpuManual(); });
            contextMenu.Items.Add(offloadGpuItem);
            contextMenu.Items.Add(wakeGpuItem);

            // 5. Auto-Offload Timer Settings
            var timerMenu = new ToolStripMenuItem("⏱️ Auto-Offload Idle Timer");
            int[] durations = new int[] { 5, 15, 30, 0 };
            foreach (var d in durations)
            {
                int currentD = d;
                string label = currentD == 0 ? "Never (Keep in VRAM)" : string.Format("{0} Minutes", currentD);
                var subItem = new ToolStripMenuItem(label, null, delegate(object s, EventArgs e) { SetIdleTimeout(currentD); });
                subItem.Tag = currentD;
                timerMenu.DropDownItems.Add(subItem);
            }
            contextMenu.Items.Add(timerMenu);

            // 6. View Live Console Logs
            var logsItem = new ToolStripMenuItem("📋 View Live Console Logs...", null, delegate(object s, EventArgs e) { OpenLogViewer(); });
            contextMenu.Items.Add(logsItem);

            contextMenu.Items.Add(new ToolStripSeparator());

            // 7. Quit
            var quitItem = new ToolStripMenuItem("❌ Quit LocalGravity Completely", null, delegate(object s, EventArgs e) { QuitApplication(); });
            contextMenu.Items.Add(quitItem);
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
                AppendLog("[Supervisor] Launching LocalGravity Central Brain 2.0...");
                string launchScript = Path.Combine(repoDir, "launch.mjs");

                var psi = new ProcessStartInfo
                {
                    FileName = "node.exe",
                    Arguments = string.Format("\"{0}\" --foreground", launchScript),
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
                        // Code 42: Self-restart triggered from chat or API!
                        AppendLog("[Supervisor] Central Brain requested self-restart (code 42). Rebooting in 500ms...");
                        Thread.Sleep(500);
                        StartBrainProcess();
                    }
                    else
                    {
                        // Unexpected crash: auto-recover after 2 seconds
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
                    req.Timeout = 1200;
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
                    // Brain is offline or starting
                    UpdateTrayState("offline", 0, 15);
                }
            });
        }

        private void ParseStatusAndUpdateUi(string json)
        {
            // Simple robust regex parsing
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
            gpuState = state;
            secondsRemaining = sec;
            idleTimeoutMinutes = timeout;

            Color dotColor;
            string tooltipText;

            if (state == "active")
            {
                dotColor = Color.FromArgb(52, 211, 153); // Emerald green
                if (timeout > 0 && sec > 0)
                {
                    int m = sec / 60;
                    int s = sec % 60;
                    tooltipText = string.Format("LocalGravity — GPU Active (Offloads in {0}m {1:D2}s)", m, s);
                }
                else if (timeout == 0)
                {
                    tooltipText = "LocalGravity — GPU Active (Auto-offload disabled)";
                }
                else
                {
                    tooltipText = "LocalGravity — GPU Active & Ready";
                }
            }
            else if (state == "standby")
            {
                dotColor = Color.FromArgb(56, 189, 248); // Sky blue
                tooltipText = "LocalGravity — Standby (0 MB VRAM • Auto-wakes on prompt)";
            }
            else if (state == "waking")
            {
                dotColor = Color.FromArgb(251, 191, 36); // Amber
                tooltipText = "LocalGravity — ⚡ Waking Strata GPU Engine...";
            }
            else
            {
                dotColor = Color.FromArgb(248, 113, 113); // Red
                tooltipText = "LocalGravity — Brain Offline / Connecting...";
            }

            if (trayIcon != null)
            {
                try
                {
                    trayIcon.Text = tooltipText.Length > 63 ? tooltipText.Substring(0, 60) + "..." : tooltipText;
                    trayIcon.Icon = CreateStatusIcon(dotColor);
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

        private void RestartCentralBrain()
        {
            AppendLog("[Tray] Restart Central Brain requested.");
            PostApi("http://127.0.0.1:3390/api/system/restart", "{}");
        }

        private void RestartStrataEngine()
        {
            AppendLog("[Tray] Restart Strata GPU Engine requested.");
            ThreadPool.QueueUserWorkItem(delegate(object s)
            {
                PostApi("http://127.0.0.1:3390/api/gpu/offload", "{}");
                Thread.Sleep(1000);
                PostApi("http://127.0.0.1:3390/api/gpu/wake", "{}");
            });
        }

        private void RestartEverything()
        {
            AppendLog("[Tray] Full Reload requested.");
            ThreadPool.QueueUserWorkItem(delegate(object s)
            {
                PostApi("http://127.0.0.1:3390/api/gpu/offload", "{}");
                Thread.Sleep(500);
                PostApi("http://127.0.0.1:3390/api/system/restart", "{}");
            });
        }

        private void OffloadGpuManual()
        {
            AppendLog("[Tray] Manual GPU offload requested.");
            PostApi("http://127.0.0.1:3390/api/gpu/offload", "{}");
        }

        private void WakeGpuManual()
        {
            AppendLog("[Tray] Manual GPU wake requested.");
            PostApi("http://127.0.0.1:3390/api/gpu/wake", "{}");
        }

        private void SetIdleTimeout(int minutes)
        {
            AppendLog(string.Format("[Tray] Setting auto-offload timer to {0} minutes.", minutes));
            PostApi("http://127.0.0.1:3390/api/gpu/timeout", string.Format("{{\"minutes\":{0}}}", minutes));
        }

        private void PostApi(string url, string jsonBody)
        {
            ThreadPool.QueueUserWorkItem(delegate(object state)
            {
                try
                {
                    var req = (HttpWebRequest)WebRequest.Create(url);
                    req.Method = "POST";
                    req.ContentType = "application/json";
                    req.Timeout = 5000;
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
                    AppendLog(string.Format("[Tray API ERROR] {0}: {1}", url, ex.Message));
                }
            });
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
                logViewer = new LogViewerForm(snapshot);
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

            // Send shutdown to brain (which will also offload GPU VRAM cleanly)
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:3390/api/system/shutdown");
                req.Method = "POST";
                req.Timeout = 1500;
                req.ContentLength = 0;
                using (var resp = req.GetResponse()) { }
            }
            catch { }

            Thread.Sleep(500);

            // Clean up child brain process if still running
            if (brainProcess != null && !brainProcess.HasExited)
            {
                try
                {
                    brainProcess.Kill();
                }
                catch { }
            }

            // Ensure port 8080 process tree is cleanly terminated
            try
            {
                var killProc = Process.Start(new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/c for /f \"tokens=5\" %a in ('netstat -aon ^| findstr :8080 ^| findstr LISTENING') do taskkill /F /PID %a",
                    CreateNoWindow = true,
                    UseShellExecute = false
                });
                if (killProc != null) killProc.WaitForExit(2000);
            }
            catch { }

            Application.Exit();
        }
    }

    public class LogViewerForm : Form
    {
        private TextBox txtLogs;
        private Button btnCopy;
        private Button btnClear;

        public LogViewerForm(List<string> initialLogs)
        {
            Text = "LocalGravity 2.0 — Live Console & Engine Logs";
            Width = 850;
            Height = 550;
            BackColor = Color.FromArgb(16, 17, 19);
            ForeColor = Color.FromArgb(232, 234, 237);
            Font = new Font("Segoe UI", 9f);
            StartPosition = FormStartPosition.CenterScreen;

            var panelTop = new Panel
            {
                Dock = DockStyle.Top,
                Height = 40,
                BackColor = Color.FromArgb(24, 25, 28)
            };

            btnCopy = new Button
            {
                Text = "Copy All Logs",
                Location = new Point(10, 8),
                Size = new Size(110, 25),
                FlatStyle = FlatStyle.Flat,
                ForeColor = Color.FromArgb(232, 234, 237),
                BackColor = Color.FromArgb(36, 37, 42)
            };
            btnCopy.Click += delegate(object s, EventArgs e) {
                if (!string.IsNullOrEmpty(txtLogs.Text))
                    Clipboard.SetText(txtLogs.Text);
            };

            btnClear = new Button
            {
                Text = "Clear Screen",
                Location = new Point(130, 8),
                Size = new Size(100, 25),
                FlatStyle = FlatStyle.Flat,
                ForeColor = Color.FromArgb(154, 160, 166),
                BackColor = Color.FromArgb(36, 37, 42)
            };
            btnClear.Click += delegate(object s, EventArgs e) { txtLogs.Clear(); };

            panelTop.Controls.Add(btnCopy);
            panelTop.Controls.Add(btnClear);

            txtLogs = new TextBox
            {
                Dock = DockStyle.Fill,
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Both,
                BackColor = Color.FromArgb(12, 13, 14),
                ForeColor = Color.FromArgb(200, 205, 210),
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
    }

    public class DarkColorTable : ProfessionalColorTable
    {
        public override Color MenuBorder { get { return Color.FromArgb(45, 47, 52); } }
        public override Color ToolStripDropDownBackground { get { return Color.FromArgb(24, 25, 28); } }
        public override Color MenuItemSelected { get { return Color.FromArgb(40, 42, 48); } }
        public override Color MenuItemBorder { get { return Color.FromArgb(60, 64, 72); } }
        public override Color SeparatorDark { get { return Color.FromArgb(38, 40, 44); } }
        public override Color SeparatorLight { get { return Color.FromArgb(38, 40, 44); } }
        public override Color MenuItemSelectedGradientBegin { get { return Color.FromArgb(40, 42, 48); } }
        public override Color MenuItemSelectedGradientEnd { get { return Color.FromArgb(40, 42, 48); } }
        public override Color MenuItemPressedGradientBegin { get { return Color.FromArgb(32, 33, 36); } }
        public override Color MenuItemPressedGradientEnd { get { return Color.FromArgb(32, 33, 36); } }
    }
}
