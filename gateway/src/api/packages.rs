use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::AppState;

pub async fn list(State(state): State<AppState>) -> Json<Value> {
    Json(json!({ "packages": state.packages() }))
}

#[derive(Deserialize)]
pub struct InstallBody {
    pub git_url: String,
}

pub async fn install(
    State(state): State<AppState>,
    Json(b): Json<InstallBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .package_install(&b.git_url)
        .map(|p| Json(json!({ "package": p })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

pub async fn uninstall(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .package_uninstall(&name)
        .map(|_| Json(json!({ "ok": true })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

#[derive(Deserialize)]
pub struct UpdateBody {
    pub to: Option<String>,
}

pub async fn update(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(b): Json<UpdateBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .package_update(&name, b.to)
        .map(|p| Json(json!({ "package": p })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

pub async fn resolve(State(state): State<AppState>) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .package_resolve()
        .map(|pkgs| Json(json!({ "packages": pkgs })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

pub async fn verify(State(state): State<AppState>) -> Json<Value> {
    Json(json!({ "results": state.package_verify() }))
}
