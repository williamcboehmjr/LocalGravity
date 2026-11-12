//! Native File Operations for LocalGravity Edge Executor.

use std::fs;
use std::path::Path;

pub struct FileOps;

impl FileOps {
    pub fn read_file(path: &str) -> Result<String, String> {
        fs::read_to_string(path).map_err(|e| format!("Failed to read file '{}': {}", path, e))
    }

    pub fn write_file(path: &str, content: &str) -> Result<(), String> {
        let p = Path::new(path);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories for '{}': {}", path, e))?;
        }
        fs::write(path, content).map_err(|e| format!("Failed to write file '{}': {}", path, e))
    }

    pub fn delete_file(path: &str) -> Result<(), String> {
        if Path::new(path).is_dir() {
            fs::remove_dir_all(path).map_err(|e| format!("Failed to remove directory '{}': {}", path, e))
        } else {
            fs::remove_file(path).map_err(|e| format!("Failed to remove file '{}': {}", path, e))
        }
    }

    pub fn list_dir(path: &str) -> Result<Vec<String>, String> {
        let entries = fs::read_dir(path).map_err(|e| format!("Failed to list directory '{}': {}", path, e))?;
        let mut results = Vec::new();
        for entry in entries.flatten() {
            if let Ok(name) = entry.file_name().into_string() {
                results.push(name);
            }
        }
        Ok(results)
    }
}
