//! Native Process Runner for LocalGravity Edge Executor.
//! Executes commands via OS-native shells (PowerShell on Windows, zsh on macOS/Linux)
//! and streams output asynchronously.

use std::process::Stdio;
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

#[derive(Debug, Clone)]
pub enum StreamChunk {
    Stdout(String),
    Stderr(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RunResult {
    pub exit_code: i32,
    pub duration_ms: u128,
    pub error: Option<String>,
}

pub struct CommandRunner;

impl CommandRunner {
    pub async fn execute_stream(
        cmd_string: &str,
        cwd: Option<&str>,
        chunk_tx: mpsc::Sender<StreamChunk>,
    ) -> RunResult {
        let start = Instant::now();

        #[cfg(target_os = "windows")]
        let mut cmd = {
            let mut c = Command::new("powershell.exe");
            c.args(["-NoProfile", "-NonInteractive", "-Command", cmd_string]);
            c.creation_flags(0x08000000);
            c
        };

        #[cfg(target_os = "android")]
        let mut cmd = {
            let mut c = Command::new("/system/bin/sh");
            c.args(["-c", cmd_string]);
            c
        };

        #[cfg(not(any(target_os = "windows", target_os = "android")))]
        let mut cmd = {
            let mut c = Command::new("/bin/zsh");
            c.args(["-c", cmd_string]);
            c
        };

        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(e) => {
                return RunResult {
                    exit_code: -1,
                    duration_ms: start.elapsed().as_millis(),
                    error: Some(format!("Failed to spawn process: {}", e)),
                };
            }
        };

        let stdout = child.stdout.take().expect("Child stdout missing");
        let stderr = child.stderr.take().expect("Child stderr missing");

        let tx_out = chunk_tx.clone();
        let tx_err = chunk_tx;

        // Stream stdout line-by-line
        let stdout_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if tx_out.send(StreamChunk::Stdout(line)).await.is_err() {
                    break;
                }
            }
        });

        // Stream stderr line-by-line
        let stderr_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if tx_err.send(StreamChunk::Stderr(line)).await.is_err() {
                    break;
                }
            }
        });

        let (status, _, _) = tokio::join!(child.wait(), stdout_task, stderr_task);

        let exit_code = match status {
            Ok(s) => s.code().unwrap_or(0),
            Err(e) => {
                return RunResult {
                    exit_code: -1,
                    duration_ms: start.elapsed().as_millis(),
                    error: Some(e.to_string()),
                }
            }
        };

        RunResult {
            exit_code,
            duration_ms: start.elapsed().as_millis(),
            error: None,
        }
    }
}
