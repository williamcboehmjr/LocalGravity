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
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
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

        // 3. Perform atomic copy via ditto
        let ditto_out = Command::new("ditto")
            .args([&source_app, target_app])
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

        // 5. Clear quarantine flags
        let _ = Command::new("xattr")
            .args(["-cr", target_app])
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = HarnessEngine::ensure_client_app_data();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_system_platform,
            get_edge_identity,
            execute_edge_tool,
            init_client_appdata,
            init_workspace_harness,
            install_dmg_update,
            install_msi_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running localgravity tauri application");
}
