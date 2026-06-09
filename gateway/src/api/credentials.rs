use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::credentials::{BackendCredentialStatus, SourceConfig};
use crate::projects::ProjectRegistry;

pub async fn list(State(reg): State<ProjectRegistry>) -> Json<Vec<BackendCredentialStatus>> {
    Json(reg.credentials().status_all())
}

#[derive(Deserialize)]
pub struct PutBody {
    pub sources: Vec<SourceConfig>,
    #[serde(default)]
    pub local_value: Option<String>,
}

pub async fn put(
    State(reg): State<ProjectRegistry>,
    Path(backend): Path<String>,
    Json(body): Json<PutBody>,
) -> Result<Json<BackendCredentialStatus>, (StatusCode, String)> {
    reg.credentials()
        .put(&backend, body.sources, body.local_value)
        .map(Json)
        .map_err(|e| (StatusCode::UNPROCESSABLE_ENTITY, e))
}

pub async fn remove(
    State(reg): State<ProjectRegistry>,
    Path(backend): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    reg.credentials()
        .delete(&backend)
        .map(|_| Json(serde_json::json!({ "ok": true })))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}
