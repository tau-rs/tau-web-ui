use axum::{http::StatusCode, Json};

use crate::api::scope::Scoped;
use crate::caps::AgentCapabilities;

/// `GET /api/projects/{pid}/capabilities` — live effective capabilities per agent.
pub async fn list(
    Scoped(state): Scoped,
) -> Result<Json<Vec<AgentCapabilities>>, (StatusCode, String)> {
    state
        .agent_capabilities()
        .map(Json)
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

#[cfg(test)]
mod tests {
    use crate::state::AppState;
    use crate::store::RunStore;
    use std::path::PathBuf;

    #[test]
    fn mock_state_returns_all_agents() {
        let dir = tempfile::tempdir().unwrap();
        let store = RunStore::new(dir.path()).unwrap();
        // Mock state (bin name contains "fake-tau-serve" -> is_mock = true).
        let state = AppState::new(
            PathBuf::from("fake-tau-serve"),
            PathBuf::from("."),
            false,
            store,
        );
        let caps = state.agent_capabilities().unwrap();
        assert_eq!(caps.len(), 4);
        assert_eq!(caps[0].agent_id, "researcher");
        assert!(caps.iter().any(|a| a.effective.is_none())); // archivist: package not installed
    }
}
