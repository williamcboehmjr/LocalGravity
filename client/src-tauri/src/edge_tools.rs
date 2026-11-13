use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tokio::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct EdgeIdentity {
    pub hostname: String,
    pub platform: String,
    pub home_dir: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EdgeToolOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub duration_ms: u128,
}

#[cfg(target_os = "android")]
fn read_android_prop(prop: &str) -> Option<String> {
    std::process::Command::new("getprop")
        .args([prop])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn get_identity() -> EdgeIdentity {
    #[cfg(target_os = "android")]
    let hostname = read_android_prop("ro.product.model")
        .unwrap_or_else(|| "Android-Device".to_string());

    #[cfg(not(target_os = "android"))]
    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| {
            let mut cmd = std::process::Command::new("hostname");
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000);
            }
            cmd.output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "edge-host".to_string())
        });

    #[cfg(target_os = "windows")]
    let platform = "windows".to_string();
    #[cfg(target_os = "macos")]
    let platform = "macos".to_string();
    #[cfg(target_os = "android")]
    let platform = {
        let release = read_android_prop("ro.build.version.release").unwrap_or_default();
        let sdk = read_android_prop("ro.build.version.sdk_full")
            .or_else(|| read_android_prop("ro.build.version.sdk"))
            .unwrap_or_default();
        match (release.is_empty(), sdk.is_empty()) {
            (false, false) => format!("Android {} (API {})", release, sdk),
            (false, true) => format!("Android {}", release),
            _ => "android".to_string(),
        }
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "android")))]
    let platform = "linux".to_string();

    #[cfg(target_os = "android")]
    let home_dir = "/storage/emulated/0".to_string();
    #[cfg(not(target_os = "android"))]
    let home_dir = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    EdgeIdentity {
        hostname,
        platform,
        home_dir,
    }
}

fn default_home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "android")]
    {
        Some(PathBuf::from("/storage/emulated/0"))
    }
    #[cfg(not(target_os = "android"))]
    {
        dirs::home_dir()
    }
}

fn effective_workspace_root(workspace_root: &str) -> PathBuf {
    #[cfg(target_os = "android")]
    {
        let trimmed = workspace_root.trim();
        let is_win_drive = trimmed.as_bytes().get(1) == Some(&b':');
        if trimmed.is_empty() || trimmed == "." || is_win_drive || !Path::new(trimmed).exists() {
            return PathBuf::from("/storage/emulated/0");
        }
        PathBuf::from(trimmed)
    }
    #[cfg(not(target_os = "android"))]
    {
        PathBuf::from(workspace_root)
    }
}

fn resolve_path(workspace_root: &str, raw: Option<&str>) -> PathBuf {
    let base_root = effective_workspace_root(workspace_root);
    let input = raw.unwrap_or("").trim();
    if input.is_empty() || input == "." {
        return base_root;
    }
    if input == "~" {
        return default_home_dir().unwrap_or(base_root);
    }
    if let Some(rest) = input.strip_prefix("~/").or_else(|| input.strip_prefix("~\\")) {
        if let Some(home) = default_home_dir() {
            return home.join(rest);
        }
    }
    let p = Path::new(input);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        base_root.join(p)
    }
}

fn should_skip_dir(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "dist" | "target" | "__pycache__" | ".venv" | "venv"
    )
}

fn ok_out(stdout: String, start: Instant) -> EdgeToolOutput {
    EdgeToolOutput {
        stdout,
        stderr: String::new(),
        exit_code: 0,
        duration_ms: start.elapsed().as_millis(),
    }
}

fn err_out(stderr: String, start: Instant) -> EdgeToolOutput {
    EdgeToolOutput {
        stdout: String::new(),
        stderr,
        exit_code: 1,
        duration_ms: start.elapsed().as_millis(),
    }
}

fn truncate_str(s: String, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s;
    }
    let head: String = s.chars().take(max_chars).collect();
    format!("{}\n\n... [truncated to {} chars]", head, max_chars)
}

pub async fn execute(tool_name: &str, args: Value, workspace_root: &str) -> EdgeToolOutput {
    let start = Instant::now();

    match tool_name {
        "read_file" => {
            let p = resolve_path(
                workspace_root,
                args["path"].as_str().or_else(|| args["file_path"].as_str()),
            );
            match fs::read_to_string(&p) {
                Ok(content) => {
                    let start_line = args["start_line"].as_u64().or_else(|| args["StartLine"].as_u64());
                    let end_line = args["end_line"].as_u64().or_else(|| args["EndLine"].as_u64());
                    let out = if start_line.is_some() || end_line.is_some() {
                        let lines: Vec<&str> = content.lines().collect();
                        let s = start_line.unwrap_or(1).max(1) as usize;
                        let e = end_line
                            .map(|v| v as usize)
                            .unwrap_or(lines.len())
                            .min(lines.len());
                        if s > lines.len() || e < s {
                            format!("(No lines in range {}-{} of {} lines)", s, e, lines.len())
                        } else {
                            lines[s - 1..e]
                                .iter()
                                .enumerate()
                                .map(|(i, l)| format!("{}: {}", s + i, l))
                                .collect::<Vec<_>>()
                                .join("\n")
                        }
                    } else {
                        content
                    };
                    ok_out(truncate_str(out, 32000), start)
                }
                Err(e) => err_out(format!("Failed to read '{}': {}", p.display(), e), start),
            }
        }

        "write_file" => {
            let p = resolve_path(
                workspace_root,
                args["path"].as_str().or_else(|| args["file_path"].as_str()),
            );
            let content = args["content"].as_str().unwrap_or("");
            if let Some(parent) = p.parent() {
                if let Err(e) = fs::create_dir_all(parent) {
                    return err_out(format!("Failed to create parent dir: {}", e), start);
                }
            }
            match fs::write(&p, content) {
                Ok(_) => ok_out(
                    format!("Successfully wrote {} bytes to {}", content.len(), p.display()),
                    start,
                ),
                Err(e) => err_out(format!("Failed to write '{}': {}", p.display(), e), start),
            }
        }

        "apply_diff" => {
            let p = resolve_path(
                workspace_root,
                args["path"].as_str().or_else(|| args["file_path"].as_str()),
            );
            let target = args["target"]
                .as_str()
                .or_else(|| args["old_text"].as_str())
                .or_else(|| args["search"].as_str())
                .unwrap_or("");
            let replacement = args["replacement"]
                .as_str()
                .or_else(|| args["new_text"].as_str())
                .or_else(|| args["replace"].as_str())
                .unwrap_or("");
            if target.is_empty() {
                return err_out("apply_diff requires a non-empty target/search string.".to_string(), start);
            }
            match fs::read_to_string(&p) {
                Ok(content) => {
                    if !content.contains(target) {
                        return err_out(
                            format!("Target block not found in '{}'. Read the file first to get exact text.", p.display()),
                            start,
                        );
                    }
                    let updated = content.replacen(target, replacement, 1);
                    match fs::write(&p, &updated) {
                        Ok(_) => ok_out(format!("Applied edit to {}", p.display()), start),
                        Err(e) => err_out(format!("Failed to save '{}': {}", p.display(), e), start),
                    }
                }
                Err(e) => err_out(format!("Failed to read '{}': {}", p.display(), e), start),
            }
        }

        "list_directory" => {
            let p = resolve_path(
                workspace_root,
                args["path"].as_str().or_else(|| args["directory"].as_str()),
            );
            match fs::read_dir(&p) {
                Ok(entries) => {
                    let mut items = Vec::new();
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        let meta = entry.metadata().ok();
                        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
                        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                        if is_dir {
                            items.push(format!("[DIR]  {}/", name));
                        } else {
                            items.push(format!("[FILE] {} ({} bytes)", name, size));
                        }
                    }
                    items.sort();
                    ok_out(
                        if items.is_empty() {
                            format!("Directory '{}' is empty.", p.display())
                        } else {
                            items.join("\n")
                        },
                        start,
                    )
                }
                Err(e) => err_out(format!("Failed to list '{}': {}", p.display(), e), start),
            }
        }

        "find_files" => {
            let base = resolve_path(
                workspace_root,
                args["directory"].as_str().or_else(|| args["path"].as_str()),
            );
            let pattern = args["pattern"]
                .as_str()
                .or_else(|| args["query"].as_str())
                .unwrap_or("")
                .trim()
                .trim_matches('*')
                .to_lowercase();
            let mut matches = Vec::new();
            let mut stack = vec![base.clone()];
            while let Some(dir) = stack.pop() {
                if matches.len() >= 150 {
                    break;
                }
                if let Ok(rd) = fs::read_dir(&dir) {
                    for entry in rd.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        let path = entry.path();
                        if path.is_dir() {
                            if !should_skip_dir(&name) {
                                stack.push(path);
                            }
                        } else {
                            let rel = path
                                .strip_prefix(&base)
                                .unwrap_or(&path)
                                .to_string_lossy()
                                .replace('\\', "/");
                            if pattern.is_empty() || rel.to_lowercase().contains(&pattern) {
                                matches.push(rel);
                            }
                        }
                    }
                }
            }
            matches.sort();
            ok_out(
                if matches.is_empty() {
                    format!("No files matched '{}' in {}", pattern, base.display())
                } else {
                    matches.join("\n")
                },
                start,
            )
        }

        "search_codebase" => {
            let base = resolve_path(
                workspace_root,
                args["directory"].as_str().or_else(|| args["path"].as_str()),
            );
            let query = args["query"]
                .as_str()
                .or_else(|| args["pattern"].as_str())
                .unwrap_or("")
                .trim();
            if query.is_empty() {
                return err_out("search_codebase requires a non-empty query.".to_string(), start);
            }
            let q_lower = query.to_lowercase();
            let mut hits = Vec::new();
            let mut stack = vec![base.clone()];
            while let Some(dir) = stack.pop() {
                if hits.len() >= 80 {
                    break;
                }
                if let Ok(rd) = fs::read_dir(&dir) {
                    for entry in rd.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        let path = entry.path();
                        if path.is_dir() {
                            if !should_skip_dir(&name) {
                                stack.push(path);
                            }
                        } else if let Ok(meta) = entry.metadata() {
                            if meta.len() <= 512_000 {
                                if let Ok(text) = fs::read_to_string(&path) {
                                    let rel = path
                                        .strip_prefix(&base)
                                        .unwrap_or(&path)
                                        .to_string_lossy()
                                        .replace('\\', "/");
                                    for (idx, line) in text.lines().enumerate() {
                                        if line.to_lowercase().contains(&q_lower) {
                                            hits.push(format!("{}:{}: {}", rel, idx + 1, line.trim()));
                                            if hits.len() >= 80 {
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            ok_out(
                if hits.is_empty() {
                    format!("No matches for '{}' in {}", query, base.display())
                } else {
                    hits.join("\n")
                },
                start,
            )
        }

        "manage_files" => {
            let action = args["action"].as_str().unwrap_or("stat");
            let p = resolve_path(
                workspace_root,
                args["path"].as_str().or_else(|| args["source"].as_str()),
            );
            match action {
                "mkdir" => match fs::create_dir_all(&p) {
                    Ok(_) => ok_out(format!("Created directory {}", p.display()), start),
                    Err(e) => err_out(format!("mkdir failed: {}", e), start),
                },
                "delete" => {
                    let res = if p.is_dir() {
                        fs::remove_dir_all(&p)
                    } else {
                        fs::remove_file(&p)
                    };
                    match res {
                        Ok(_) => ok_out(format!("Deleted {}", p.display()), start),
                        Err(e) => err_out(format!("delete failed: {}", e), start),
                    }
                }
                "copy" => {
                    let dest = resolve_path(workspace_root, args["destination"].as_str());
                    match fs::copy(&p, &dest) {
                        Ok(bytes) => ok_out(format!("Copied {} bytes to {}", bytes, dest.display()), start),
                        Err(e) => err_out(format!("copy failed: {}", e), start),
                    }
                }
                "move" => {
                    let dest = resolve_path(workspace_root, args["destination"].as_str());
                    match fs::rename(&p, &dest) {
                        Ok(_) => ok_out(format!("Moved {} -> {}", p.display(), dest.display()), start),
                        Err(e) => err_out(format!("move failed: {}", e), start),
                    }
                }
                _ => match fs::metadata(&p) {
                    Ok(m) => ok_out(
                        format!(
                            "path: {}\nis_dir: {}\nsize_bytes: {}",
                            p.display(),
                            m.is_dir(),
                            m.len()
                        ),
                        start,
                    ),
                    Err(e) => err_out(format!("stat failed: {}", e), start),
                },
            }
        }

        "inspect_file_metadata" => {
            let p = resolve_path(workspace_root, args["path"].as_str());
            match fs::metadata(&p) {
                Ok(m) => ok_out(
                    format!(
                        "path: {}\nis_dir: {}\nsize_bytes: {}",
                        p.display(),
                        m.is_dir(),
                        m.len()
                    ),
                    start,
                ),
                Err(e) => err_out(format!("Failed to inspect '{}': {}", p.display(), e), start),
            }
        }

        "run_terminal" => {
            let cmd_str = args["command"].as_str().unwrap_or("").trim();
            if cmd_str.is_empty() {
                return err_out("run_terminal requires a non-empty command.".to_string(), start);
            }
            let cwd = resolve_path(
                workspace_root,
                args["cwd"].as_str().or_else(|| args["directory"].as_str()),
            );

            #[cfg(target_os = "windows")]
            let mut cmd = {
                let mut c = Command::new("powershell.exe");
                c.args(["-NoProfile", "-NonInteractive", "-Command", cmd_str]);
                c.creation_flags(0x08000000);
                c
            };
            #[cfg(target_os = "android")]
            let mut cmd = {
                let mut c = Command::new("/system/bin/sh");
                c.args(["-c", cmd_str]);
                c.env("HOME", "/storage/emulated/0");
                c
            };
            #[cfg(not(any(target_os = "windows", target_os = "android")))]
            let mut cmd = {
                let mut c = Command::new("/bin/zsh");
                c.args(["-c", cmd_str]);
                c
            };

            if cwd.exists() {
                cmd.current_dir(&cwd);
            } else {
                #[cfg(target_os = "android")]
                cmd.current_dir("/storage/emulated/0");
            }

            match cmd.output().await {
                Ok(out) => EdgeToolOutput {
                    stdout: truncate_str(String::from_utf8_lossy(&out.stdout).to_string(), 16000),
                    stderr: truncate_str(String::from_utf8_lossy(&out.stderr).to_string(), 8000),
                    exit_code: out.status.code().unwrap_or(0),
                    duration_ms: start.elapsed().as_millis(),
                },
                Err(e) => err_out(format!("Failed to execute command '{}': {}", cmd_str, e), start),
            }
        }

        other => err_out(format!("Unsupported edge tool: {}", other), start),
    }
}
