use axum::{extract::State, http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::config::ProjectConfig;
use crate::state::AppState;

pub async fn get(
    State(state): State<AppState>,
) -> Result<Json<ProjectConfig>, (StatusCode, String)> {
    state
        .config_read()
        .map(Json)
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

#[derive(Deserialize)]
pub struct PutBody {
    pub name: String,
    pub description: Option<String>,
}

pub async fn put(
    State(state): State<AppState>,
    Json(b): Json<PutBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .config_write(&b.name, b.description.as_deref())
        .map(|_| Json(json!({ "ok": true })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}
