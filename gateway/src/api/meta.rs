use axum::{extract::State, Json};
use serde_json::{json, Value};

use crate::state::AppState;

pub async fn project(State(state): State<AppState>) -> Json<Value> {
    match state.handshake().await {
        Ok(hs) => Json(json!({
            "project_path": hs.project_path, "agents": hs.agents,
            "tau_version": hs.server_version,
        })),
        Err(e) => Json(json!({ "error": e.to_string() })),
    }
}

pub async fn health(State(state): State<AppState>) -> Json<Value> {
    let (ok, ver) = match state.handshake().await {
        Ok(hs) => (true, hs.server_version),
        Err(_) => (false, String::new()),
    };
    Json(json!({
        "gateway_ok": true,
        "tau_bin": state.0.bin.to_string_lossy(),
        "tau_version": ver,
        "engine_ok": ok,
    }))
}
