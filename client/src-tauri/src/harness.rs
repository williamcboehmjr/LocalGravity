//! Google Harness² 8-Component Manager & Propose-Probe-Compose Loop for LocalGravity Edge Client.
//! Manages decoupled client state in OS AppData (`~/Library/Application Support/LocalGravity` on macOS,
//! `%APPDATA%\LocalGravity` on Windows) and `.localgravity/harness/` inside each project workspace.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ClientAppDataState {
    pub app_data_dir: String,
    pub mcp_config_path: String,
    pub projects_config_path: String,
    pub agent_md_path: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PpcCycleReport {
    pub failed_command: String,
    pub proposed_file: String,
    pub proposed_rule: String,
    pub probe_exit_code: i32,
    pub composed_experience: String,
}

pub struct HarnessEngine {
    pub failure_counts: HashMap<String, u32>,
}

impl Default for HarnessEngine {
    fn default() -> Self {
        Self {
            failure_counts: HashMap::new(),
        }
    }
}

impl HarnessEngine {
    /// Resolves `~/Library/Application Support/LocalGravity` on macOS and `%APPDATA%\LocalGravity` on Windows.
    pub fn get_client_app_data_dir() -> PathBuf {
        if let Some(base) = dirs::data_dir().or_else(dirs::config_dir) {
            base.join("LocalGravity")
        } else {
            PathBuf::from(".localgravity_appdata")
        }
    }

    /// Initializes decoupled client state files (`mcp_config.json`, `projects.json`, `agent.md`)
    /// inside the local user directory with zero dependency on the Windows Brain filesystem.
    pub fn ensure_client_app_data() -> Result<ClientAppDataState, String> {
        let dir = Self::get_client_app_data_dir();
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

        let mcp_path = dir.join("mcp_config.json");
        if !mcp_path.exists() {
            let default_mcp = serde_json::json!({
                "mcpServers": {
                    "local-fetch": {
                        "command": "uvx",
                        "args": ["mcp-server-fetch"],
                        "enabled": true
                    },
                    "filesystem": {
                        "command": "npx",
                        "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
                        "enabled": true
                    }
                }
            });
            fs::write(
                &mcp_path,
                serde_json::to_string_pretty(&default_mcp).unwrap_or_default(),
            )
            .map_err(|e| e.to_string())?;
        }

        let projects_path = dir.join("projects.json");
        if !projects_path.exists() {
            let default_projects = serde_json::json!({
                "version": "2.0.0",
                "projects": []
            });
            fs::write(
                &projects_path,
                serde_json::to_string_pretty(&default_projects).unwrap_or_default(),
            )
            .map_err(|e| e.to_string())?;
        }

        let agent_md_path = dir.join("agent.md");
        if !agent_md_path.exists() {
            let agent_md = "# LocalGravity Native Client Agent Context (agent.md)\n\
                - Decoupled Client State initialized in OS AppData.\n\
                - All workspace folders, git repositories, and `.localgravity/harness/` components are managed locally.\n";
            fs::write(&agent_md_path, agent_md).map_err(|e| e.to_string())?;
        }

        Ok(ClientAppDataState {
            app_data_dir: dir.to_string_lossy().to_string(),
            mcp_config_path: mcp_path.to_string_lossy().to_string(),
            projects_config_path: projects_path.to_string_lossy().to_string(),
            agent_md_path: agent_md_path.to_string_lossy().to_string(),
        })
    }

    /// Initializes the 8-Component Harness² directory (`.localgravity/harness/`) in a project workspace.
    pub fn ensure_workspace_harness(workspace_root: &str) -> Result<String, String> {
        let harness_dir = Path::new(workspace_root)
            .join(".localgravity")
            .join("harness");
        fs::create_dir_all(&harness_dir).map_err(|e| e.to_string())?;

        let files = [
            (
                "system.md",
                "# Harness² Component 1: System Prompt\nCore role and operational constraints.\n",
            ),
            (
                "guardrails.md",
                "# Harness² Component 2: Guardrails\nSafety rules and destructive command preventions. Never bind ports 5000 or 5001.\n",
            ),
            (
                "memory.md",
                "# Harness² Component 3: Memory\nPersistent cross-turn workspace learnings.\n",
            ),
            (
                "EXPERIENCE.md",
                "# Harness² Component 3B: Composed Experience Log (EXPERIENCE.md)\nProcedural fixes committed via Propose-Probe-Compose.\n",
            ),
            (
                "tools.md",
                "# Harness² Component 4: Tool Guidance\nInstructions for MCP tools, ripgrep, and PTY shell commands.\n",
            ),
            (
                "subagents.md",
                "# Harness² Component 5: Subagents\nDelegation rules for complex multi-file refactoring.\n",
            ),
        ];

        for (name, content) in files {
            let p = harness_dir.join(name);
            if !p.exists() {
                fs::write(&p, content).map_err(|e| e.to_string())?;
            }
        }

        for subdir in ["skills", "scripts", "plugins"] {
            fs::create_dir_all(harness_dir.join(subdir)).map_err(|e| e.to_string())?;
        }

        Ok(harness_dir.to_string_lossy().to_string())
    }

    /// Propose-Probe-Compose Loop:
    /// Triggered when a command/tool fails twice in the workspace.
    pub fn propose_and_compose_fix(
        &mut self,
        workspace_root: &str,
        command: &str,
        stderr: &str,
        probe_exit_code: i32,
    ) -> Result<PpcCycleReport, String> {
        let _ = Self::ensure_workspace_harness(workspace_root);
        let harness_dir = Path::new(workspace_root)
            .join(".localgravity")
            .join("harness");

        let target_file = if stderr.to_lowercase().contains("permission")
            || stderr.contains("5000")
            || stderr.contains("5001")
        {
            "guardrails.md"
        } else {
            "tools.md"
        };

        let proposed_rule = format!(
            "\n- **[PPC Auto-Rule]**: Command `{}` failed (`{}`). Verified fallback exit_code={}.\n",
            command,
            stderr.lines().next().unwrap_or("error"),
            probe_exit_code
        );

        let target_path = harness_dir.join(target_file);
        let existing = fs::read_to_string(&target_path).unwrap_or_default();
        fs::write(&target_path, format!("{}{}", existing, proposed_rule))
            .map_err(|e| e.to_string())?;

        let composed_entry = format!(
            "\n### [PPC Composed Fix]\n- **Command**: `{}`\n- **Adjusted**: `{}`\n- **Probe Exit Code**: `{}`\n",
            command, target_file, probe_exit_code
        );
        let exp_path = harness_dir.join("EXPERIENCE.md");
        let existing_exp = fs::read_to_string(&exp_path).unwrap_or_default();
        fs::write(&exp_path, format!("{}{}", existing_exp, composed_entry))
            .map_err(|e| e.to_string())?;

        Ok(PpcCycleReport {
            failed_command: command.to_string(),
            proposed_file: target_file.to_string(),
            proposed_rule,
            probe_exit_code,
            composed_experience: composed_entry,
        })
    }
}
