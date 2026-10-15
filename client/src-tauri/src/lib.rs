pub mod file_ops;
pub mod policy;
pub mod runner;
pub mod ws_client;

use tauri::Manager;

#[tauri::command]
fn get_system_platform() -> String {
    #[cfg(target_os = "windows")]
    return "windows".to_string();
    #[cfg(target_os = "macos")]
    return "macos".to_string();
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    return "linux".to_string();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![get_system_platform])
        .run(tauri::generate_context!())
        .expect("error while running localgravity tauri application");
}
