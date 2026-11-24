pub mod edge_tools;
pub mod file_ops;
pub mod harness;
pub mod policy;
pub mod runner;
pub mod ws_client;

use edge_tools::{EdgeIdentity, EdgeToolOutput};
use harness::{ClientAppDataState, HarnessEngine};

#[tauri::command]
fn get_edge_identity() -> EdgeIdentity {
    edge_tools::get_identity()
}

#[tauri::command]
async fn execute_edge_tool(
    tool_name: String,
    args: serde_json::Value,
    workspace_root: String,
) -> EdgeToolOutput {
    edge_tools::execute(&tool_name, args, &workspace_root).await
}

#[tauri::command]
fn get_system_platform() -> String {
    #[cfg(target_os = "windows")]
    return "windows".to_string();
    #[cfg(target_os = "macos")]
    return "macos".to_string();
    #[cfg(target_os = "android")]
    return "android".to_string();
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "android")))]
    return "linux".to_string();
}

#[tauri::command]
fn init_client_appdata() -> Result<ClientAppDataState, String> {
    HarnessEngine::ensure_client_app_data()
}

#[tauri::command]
fn init_workspace_harness(workspace_root: String) -> Result<String, String> {
    HarnessEngine::ensure_workspace_harness(&workspace_root)
}

#[tauri::command]
async fn install_dmg_update(dmg_url: String) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        // 1. Download DMG using curl to /tmp/localgravity_update.dmg
        let temp_dmg = "/tmp/localgravity_update.dmg";
        let _ = std::fs::remove_file(temp_dmg);

        let curl_out = Command::new("/usr/bin/curl")
            .args(["-s", "-L", "-f", "-o", temp_dmg, &dmg_url])
            .output()
            .map_err(|e| format!("curl execution failed: {}", e))?;

        if !curl_out.status.success() {
            return Err(format!(
                "Failed to download update from {}: {}",
                dmg_url,
                String::from_utf8_lossy(&curl_out.stderr)
            ));
        }

        // 2. Attach DMG with nobrowse
        let attach_out = Command::new("hdiutil")
            .args(["attach", temp_dmg, "-nobrowse"])
            .output()
            .map_err(|e| format!("Failed to attach DMG: {}", e))?;

        if !attach_out.status.success() {
            return Err(format!(
                "hdiutil attach failed: {}",
                String::from_utf8_lossy(&attach_out.stderr)
            ));
        }

        let attach_stdout = String::from_utf8_lossy(&attach_out.stdout);
        let mut mount_path = String::new();
        for line in attach_stdout.lines() {
            if let Some(pos) = line.find("/Volumes/") {
                mount_path = line[pos..].trim().to_string();
                break;
            }
        }

        if mount_path.is_empty() {
            return Err("Failed to find /Volumes mount path from hdiutil output".to_string());
        }

        let source_app = format!("{}/LocalGravity.app", mount_path);
        let target_app = "/Applications/LocalGravity.app";

        // 3. Perform atomic copy via ditto without resource forks or extended attributes
        let ditto_out = Command::new("ditto")
            .args(["--norsrc", "--noextattr", &source_app, target_app])
            .output()
            .map_err(|e| format!("Failed to copy application: {}", e))?;

        // 4. Eject the DMG
        let _ = Command::new("hdiutil")
            .args(["detach", &mount_path, "-force"])
            .output();

        let _ = std::fs::remove_file(temp_dmg);

        if !ditto_out.status.success() {
            return Err(format!(
                "ditto failed to copy app: {}",
                String::from_utf8_lossy(&ditto_out.stderr)
            ));
        }

        // 5. Clear quarantine flags and refresh ad-hoc signature for macOS Gatekeeper
        let _ = Command::new("xattr")
            .args(["-cr", target_app])
            .output();
        let _ = Command::new("codesign")
            .args(["--force", "--deep", "--sign", "-", target_app])
            .output();

        // 6. Spawn relaunch script in detached background and exit
        let relaunch_cmd = format!("sleep 1; open '{}'", target_app);
        let _ = Command::new("/bin/sh")
            .args(["-c", &relaunch_cmd])
            .spawn();

        std::process::exit(0);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = dmg_url;
        Err("install_dmg_update is only supported on macOS".to_string())
    }
}

#[tauri::command]
async fn install_msi_update(msi_url: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        let temp_dir = std::env::temp_dir();
        let temp_msi = temp_dir.join("localgravity_update.msi");
        let temp_msi_str = temp_msi.to_string_lossy().to_string();
        let _ = std::fs::remove_file(&temp_msi);

        let curl_out = Command::new("curl.exe")
            .args(["-s", "-L", "-f", "-o", &temp_msi_str, &msi_url])
            .creation_flags(0x08000000)
            .output()
            .map_err(|e| format!("curl.exe execution failed: {}", e))?;

        if !curl_out.status.success() {
            return Err(format!(
                "Failed to download MSI update from {}: {}",
                msi_url,
                String::from_utf8_lossy(&curl_out.stderr)
            ));
        }

        let ps_cmd = format!(
            "Start-Sleep -Milliseconds 600; Start-Process msiexec.exe -ArgumentList '/i', '\"{}\"', '/passive', '/norestart' -Wait; Start-Process 'C:\\Program Files\\LocalGravity\\localgravity-edge.exe'",
            temp_msi_str
        );
        let _ = Command::new("powershell.exe")
            .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &ps_cmd])
            .creation_flags(0x08000000)
            .spawn();

        std::process::exit(0);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = msi_url;
        Err("install_msi_update is only supported on Windows".to_string())
    }
}

#[tauri::command]
async fn install_linux_update(deb_url: String) -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;

        let temp_deb = "/tmp/localgravity_update.deb";
        let _ = std::fs::remove_file(temp_deb);

        let curl_out = Command::new("curl")
            .args(["-s", "-L", "-f", "-o", temp_deb, &deb_url])
            .output()
            .map_err(|e| format!("curl execution failed: {}", e))?;

        if !curl_out.status.success() {
            return Err(format!(
                "Failed to download DEB update from {}: {}",
                deb_url,
                String::from_utf8_lossy(&curl_out.stderr)
            ));
        }

        let relaunch_script = "nohup sh -c \"sleep 1; (sudo -n apt-get install -y /tmp/localgravity_update.deb || sudo -n dpkg -i /tmp/localgravity_update.deb || pkexec dpkg -i /tmp/localgravity_update.deb) && rm -f /tmp/localgravity_update.deb && /usr/bin/localgravity-edge >/dev/null 2>&1 &\" >/dev/null 2>&1 &";
        let _ = Command::new("sh")
            .args(["-c", relaunch_script])
            .spawn();

        std::process::exit(0);
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = deb_url;
        Err("install_linux_update is only supported on Linux".to_string())
    }
}

#[tauri::command]
fn get_tray_supervisor_status() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        let local_app = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let installed_path = std::path::PathBuf::from(&local_app)
            .join("LocalGravity")
            .join("tray.exe");
        let exe_dir_tray = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("tray.exe")));

        let resolved = if installed_path.exists() {
            Some(installed_path)
        } else if exe_dir_tray.as_ref().map(|p| p.exists()).unwrap_or(false) {
            exe_dir_tray
        } else {
            None
        };

        let autostart = Command::new("reg.exe")
            .args([
                "query",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                "LocalGravityTray",
            ])
            .creation_flags(0x08000000)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        let running = Command::new("tasklist.exe")
            .args(["/FI", "IMAGENAME eq tray.exe", "/NH"])
            .creation_flags(0x08000000)
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains("tray.exe"))
            .unwrap_or(false);

        return Ok(serde_json::json!({
            "platform": "windows",
            "installed": resolved.is_some(),
            "running": running,
            "autostart": autostart,
            "path": resolved.map(|p| p.to_string_lossy().to_string()),
        }));
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let plist = std::path::PathBuf::from(&home)
            .join("Library/LaunchAgents/com.localgravity.brain.plist");
        let installed = plist.exists();
        return Ok(serde_json::json!({
            "platform": "macos",
            "installed": installed,
            "running": installed,
            "autostart": installed,
            "path": if installed { Some(plist.to_string_lossy().to_string()) } else { None },
        }));
    }

    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let svc = std::path::PathBuf::from(&home)
            .join(".config/systemd/user/localgravity-brain.service");
        let desktop = std::path::PathBuf::from(&home)
            .join(".config/autostart/localgravity-brain.desktop");
        let installed = svc.exists() || desktop.exists();
        let path = if svc.exists() {
            Some(svc.to_string_lossy().to_string())
        } else if desktop.exists() {
            Some(desktop.to_string_lossy().to_string())
        } else {
            None
        };
        return Ok(serde_json::json!({
            "platform": "linux",
            "installed": installed,
            "running": installed,
            "autostart": installed,
            "path": path,
        }));
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        Ok(serde_json::json!({
            "platform": "mobile",
            "installed": false,
            "running": false,
            "autostart": false,
            "path": serde_json::Value::Null,
        }))
    }
}

#[tauri::command]
async fn install_tray_supervisor(enable_autostart: bool) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        let local_app = std::env::var("LOCALAPPDATA")
            .map_err(|_| "LOCALAPPDATA environment variable not set".to_string())?;
        let target_dir = std::path::PathBuf::from(&local_app).join("LocalGravity");
        std::fs::create_dir_all(&target_dir)
            .map_err(|e| format!("Failed to create {}: {}", target_dir.display(), e))?;
        let target_tray = target_dir.join("tray.exe");

        // Copy bundled tray.exe next to executable if present, otherwise download from latest GitHub release
        let exe_dir_tray = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("tray.exe")));

        if !target_tray.exists() {
            if let Some(src) = exe_dir_tray.filter(|p| p.exists()) {
                std::fs::copy(&src, &target_tray)
                    .map_err(|e| format!("Failed to copy tray.exe: {}", e))?;
            } else {
                let url = "https://github.com/williamcboehmjr/LocalGravity/releases/latest/download/tray.exe";
                let target_str = target_tray.to_string_lossy().to_string();
                let out = Command::new("curl.exe")
                    .args(["-s", "-L", "-f", "-o", &target_str, url])
                    .creation_flags(0x08000000)
                    .output()
                    .map_err(|e| format!("Failed to run curl.exe for tray.exe: {}", e))?;
                if !out.status.success() {
                    return Err(format!(
                        "Failed to download tray.exe from GitHub release: {}",
                        String::from_utf8_lossy(&out.stderr)
                    ));
                }
            }
        }

        let quoted_path = format!("\"{}\"", target_tray.to_string_lossy());
        if enable_autostart {
            let reg_out = Command::new("reg.exe")
                .args([
                    "add",
                    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                    "/v",
                    "LocalGravityTray",
                    "/t",
                    "REG_SZ",
                    "/d",
                    &quoted_path,
                    "/f",
                ])
                .creation_flags(0x08000000)
                .output()
                .map_err(|e| format!("Failed to register Windows startup entry: {}", e))?;
            if !reg_out.status.success() {
                return Err(format!(
                    "Registry Run update failed: {}",
                    String::from_utf8_lossy(&reg_out.stderr)
                ));
            }
        } else {
            let _ = Command::new("reg.exe")
                .args([
                    "delete",
                    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                    "/v",
                    "LocalGravityTray",
                    "/f",
                ])
                .creation_flags(0x08000000)
                .output();
        }

        let _ = Command::new(&target_tray)
            .current_dir(&target_dir)
            .creation_flags(0x00000008) // DETACHED_PROCESS
            .spawn()
            .map_err(|e| format!("Failed to start tray.exe: {}", e))?;

        return Ok(format!(
            "Installed & started tray.exe at {}{}",
            target_tray.display(),
            if enable_autostart { " (Windows startup enabled)" } else { "" }
        ));
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
        let server_js = [
            format!("{}/LocalGravity/server/dist/index.js", home),
            format!("{}/.localgravity/server/dist/index.js", home),
        ]
        .into_iter()
        .find(|p| std::path::Path::new(p).exists())
        .ok_or_else(|| {
            "Could not find LocalGravity/server/dist/index.js on this Mac. Clone/build LocalGravity server first or connect to a remote Central Brain.".to_string()
        })?;

        let launch_agents = std::path::PathBuf::from(&home).join("Library/LaunchAgents");
        std::fs::create_dir_all(&launch_agents)
            .map_err(|e| format!("Failed to create LaunchAgents dir: {}", e))?;
        let plist_path = launch_agents.join("com.localgravity.brain.plist");
        let plist_xml = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n  <key>Label</key><string>com.localgravity.brain</string>\n  <key>ProgramArguments</key>\n  <array>\n    <string>/usr/bin/env</string>\n    <string>node</string>\n    <string>{}</string>\n  </array>\n  <key>RunAtLoad</key><{}/>\n  <key>KeepAlive</key><true/>\n</dict>\n</plist>\n",
            server_js,
            if enable_autostart { "true" } else { "false" }
        );
        std::fs::write(&plist_path, plist_xml)
            .map_err(|e| format!("Failed to write LaunchAgent plist: {}", e))?;
        let _ = Command::new("launchctl")
            .args(["unload", &plist_path.to_string_lossy()])
            .output();
        let _ = Command::new("launchctl")
            .args(["load", "-w", &plist_path.to_string_lossy()])
            .output();
        return Ok(format!("Configured macOS LaunchAgent at {}", plist_path.display()));
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;

        let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
        let server_js = [
            format!("{}/LocalGravity/server/dist/index.js", home),
            format!("{}/.localgravity/server/dist/index.js", home),
        ]
        .into_iter()
        .find(|p| std::path::Path::new(p).exists())
        .ok_or_else(|| {
            "Could not find LocalGravity/server/dist/index.js on this Linux host. Clone/build LocalGravity server first or connect to a remote Central Brain.".to_string()
        })?;

        let systemd_dir = std::path::PathBuf::from(&home).join(".config/systemd/user");
        std::fs::create_dir_all(&systemd_dir)
            .map_err(|e| format!("Failed to create systemd user dir: {}", e))?;
        let unit_path = systemd_dir.join("localgravity-brain.service");
        let unit_body = format!(
            "[Unit]\nDescription=LocalGravity Central Brain Supervisor\nAfter=network.target\n\n[Service]\nExecStart=/usr/bin/env node {}\nRestart=always\nRestartSec=3\n\n[Install]\nWantedBy=default.target\n",
            server_js
        );
        std::fs::write(&unit_path, unit_body)
            .map_err(|e| format!("Failed to write systemd unit: {}", e))?;
        let _ = Command::new("systemctl").args(["--user", "daemon-reload"]).output();
        if enable_autostart {
            let _ = Command::new("systemctl")
                .args(["--user", "enable", "--now", "localgravity-brain.service"])
                .output();
        } else {
            let _ = Command::new("systemctl")
                .args(["--user", "start", "localgravity-brain.service"])
                .output();
        }
        return Ok(format!("Configured Linux user service at {}", unit_path.display()));
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = enable_autostart;
        Err("Tray supervisor is only supported on desktop platforms (Windows, macOS, Linux).".to_string())
    }
}

#[tauri::command]
fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    if app.shell().open(&url, None).is_ok() {
        return Ok(());
    }
    #[cfg(target_os = "android")]
    {
        let status = std::process::Command::new("am")
            .args(["start", "-a", "android.intent.action.VIEW", "-d", &url])
            .status()
            .map_err(|e| format!("Failed to open URL on Android: {}", e))?;
        if status.success() {
            return Ok(());
        }
    }
    Err(format!("Failed to open external URL: {}", url))
}

#[tauri::command]
fn is_linux_appimage() -> bool {
    #[cfg(target_os = "linux")]
    {
        std::env::var("APPIMAGE")
            .map(|v| !v.is_empty())
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = HarnessEngine::ensure_client_app_data();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .invoke_handler(tauri::generate_handler![
            get_system_platform,
            get_edge_identity,
            execute_edge_tool,
            init_client_appdata,
            init_workspace_harness,
            install_dmg_update,
            install_msi_update,
            install_linux_update,
            get_tray_supervisor_status,
            install_tray_supervisor,
            open_external_url,
            is_linux_appimage
        ])
        .run(tauri::generate_context!())
        .expect("error while running localgravity tauri application");
}
