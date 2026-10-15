//! Execution Security Policy Gatekeeper for LocalGravity Edge Executor.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecutionPolicy {
    AlwaysProceed,
    RequestReview,
}

pub struct PolicyGatekeeper {
    pub policy: ExecutionPolicy,
    pub allowlist: Vec<String>,
}

impl Default for PolicyGatekeeper {
    fn default() -> Self {
        Self {
            policy: ExecutionPolicy::AlwaysProceed,
            allowlist: vec![
                "git status".into(),
                "git diff".into(),
                "git log".into(),
                "dir".into(),
                "ls".into(),
                "pwd".into(),
            ],
        }
    }
}

impl PolicyGatekeeper {
    pub fn requires_review(&self, command: &str) -> bool {
        if self.policy == ExecutionPolicy::AlwaysProceed {
            return false;
        }

        let cmd_trimmed = command.trim().to_lowercase();
        for safe in &self.allowlist {
            if cmd_trimmed.starts_with(safe) {
                return false;
            }
        }
        true
    }
}
