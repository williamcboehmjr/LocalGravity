//! Reverse-RPC WebSocket Client for LocalGravity Edge Executor.
//! Connects to Central Brain, listens for EXEC_REQUEST, and executes locally.

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

use crate::file_ops::FileOps;
use crate::policy::PolicyGatekeeper;
use crate::runner::{CommandRunner, StreamChunk};

pub struct EdgeWsClient {
    pub brain_url: String,
    pub session_id: String,
    pub workspace_path: String,
    pub policy: Arc<Mutex<PolicyGatekeeper>>,
}

impl EdgeWsClient {
    pub fn new(brain_url: String, session_id: String, workspace_path: String) -> Self {
        Self {
            brain_url,
            session_id,
            workspace_path,
            policy: Arc::new(Mutex::new(PolicyGatekeeper::default())),
        }
    }

    pub async fn run(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let ws_url = format!("{}/ws/agent/{}", self.brain_url, self.session_id);
        let (ws_stream, _) = connect_async(&ws_url).await?;
        let (mut write, mut read) = ws_stream.split();

        // 1. Send SESSION_INIT
        #[cfg(target_os = "windows")]
        let platform = "windows";
        #[cfg(target_os = "macos")]
        let platform = "macos";
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        let platform = "linux";

        let init_msg = serde_json::json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "type": "SESSION_INIT",
            "payload": {
                "workspace_path": self.workspace_path,
                "platform": platform,
                "client_version": "0.1.0",
                "hostname": "edge-client"
            }
        });
        write.send(Message::Text(init_msg.to_string())).await?;

        // Shared writer channel for concurrent async tasks
        let (tx, mut rx) = mpsc::channel::<String>(100);
        tokio::spawn(async move {
            while let Some(msg_text) = rx.recv().await {
                if write.send(Message::Text(msg_text)).await.is_err() {
                    break;
                }
            }
        });

        // 2. Read incoming commands from Central Brain
        while let Some(msg_result) = read.next().await {
            let msg = match msg_result {
                Ok(Message::Text(text)) => text,
                _ => continue,
            };

            let data: Value = match serde_json::from_str(&msg) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let msg_type = data["type"].as_str().unwrap_or("");
            let req_id = data["id"].as_str().unwrap_or("").to_string();

            if msg_type == "EXEC_REQUEST" {
                let payload = &data["payload"];
                let action = payload["action"].as_str().unwrap_or("");
                let tx_clone = tx.clone();
                let workspace = self.workspace_path.clone();

                match action {
                    "shell" => {
                        let cmd = payload["command"].as_str().unwrap_or("").to_string();
                        let cwd = payload["cwd"].as_str().unwrap_or(&workspace).to_string();

                        tokio::spawn(async move {
                            let (chunk_tx, mut chunk_rx) = mpsc::channel::<StreamChunk>(50);
                            let req_id_stream = req_id.clone();
                            let tx_stream = tx_clone.clone();

                            // Forward live stdout/stderr chunks
                            let stream_task = tokio::spawn(async move {
                                while let Some(chunk) = chunk_rx.recv().await {
                                    let (stream_name, text) = match chunk {
                                        StreamChunk::Stdout(s) => ("stdout", s),
                                        StreamChunk::Stderr(s) => ("stderr", s),
                                    };
                                    let chunk_msg = serde_json::json!({
                                        "id": uuid::Uuid::new_v4().to_string(),
                                        "type": "EXEC_STREAM",
                                        "payload": {
                                            "request_id": req_id_stream,
                                            "stream": stream_name,
                                            "chunk": text
                                        }
                                    });
                                    let _ = tx_stream.send(chunk_msg.to_string()).await;
                                }
                            });

                            let result = CommandRunner::execute_stream(&cmd, Some(&cwd), chunk_tx).await;
                            let _ = stream_task.await;

                            let result_msg = serde_json::json!({
                                "id": uuid::Uuid::new_v4().to_string(),
                                "type": "EXEC_RESULT",
                                "payload": {
                                    "request_id": req_id,
                                    "exit_code": result.exit_code,
                                    "duration_ms": result.duration_ms,
                                    "error": result.error
                                }
                            });
                            let _ = tx_clone.send(result_msg.to_string()).await;
                        });
                    }

                    "read_file" => {
                        let path = payload["path"].as_str().unwrap_or("").to_string();
                        let read_res = FileOps::read_file(&path);
                        let result_msg = match read_res {
                            Ok(content) => serde_json::json!({
                                "id": uuid::Uuid::new_v4().to_string(),
                                "type": "EXEC_RESULT",
                                "payload": {
                                    "request_id": req_id,
                                    "exit_code": 0,
                                    "duration_ms": 1,
                                    "data": content
                                }
                            }),
                            Err(e) => serde_json::json!({
                                "id": uuid::Uuid::new_v4().to_string(),
                                "type": "EXEC_RESULT",
                                "payload": {
                                    "request_id": req_id,
                                    "exit_code": 1,
                                    "duration_ms": 1,
                                    "error": e
                                }
                            }),
                        };
                        let _ = tx_clone.send(result_msg.to_string()).await;
                    }

                    "write_file" => {
                        let path = payload["path"].as_str().unwrap_or("").to_string();
                        let content = payload["content"].as_str().unwrap_or("").to_string();
                        let write_res = FileOps::write_file(&path, &content);
                        let result_msg = match write_res {
                            Ok(_) => serde_json::json!({
                                "id": uuid::Uuid::new_v4().to_string(),
                                "type": "EXEC_RESULT",
                                "payload": {
                                    "request_id": req_id,
                                    "exit_code": 0,
                                    "duration_ms": 2,
                                    "data": "File written successfully"
                                }
                            }),
                            Err(e) => serde_json::json!({
                                "id": uuid::Uuid::new_v4().to_string(),
                                "type": "EXEC_RESULT",
                                "payload": {
                                    "request_id": req_id,
                                    "exit_code": 1,
                                    "duration_ms": 2,
                                    "error": e
                                }
                            }),
                        };
                        let _ = tx_clone.send(result_msg.to_string()).await;
                    }
                    _ => {}
                }
            }
        }

        Ok(())
    }
}
