pub mod file_ops;
pub mod harness;
pub mod policy;
pub mod runner;
pub mod ws_client;

use harness::{ClientAppDataState, HarnessEngine};

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
            init_client_appdata,
            init_workspace_harness
        ])
        .run(tauri::generate_context!())
        .expect("error while running localgravity tauri application");
}
