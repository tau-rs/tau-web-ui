use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::projects::{CrossProjectRun, ProjectListItem, ProjectMeta, ProjectRegistry};
use crate::state::now;

pub async fn list(State(reg): State<ProjectRegistry>) -> Json<Vec<ProjectListItem>> {
    Json(reg.list_summaries(&now()).await)
}

#[derive(Deserialize)]
pub struct CrossQuery {
    pub status: Option<String>,
    pub limit: Option<usize>,
}

pub async fn cross_runs(
    State(reg): State<ProjectRegistry>,
    Query(q): Query<CrossQuery>,
) -> Json<Vec<CrossProjectRun>> {
    Json(
        reg.cross_runs(q.status.as_deref(), q.limit.unwrap_or(50))
            .await,
    )
}

#[derive(Deserialize)]
pub struct AddBody {
    pub path: Option<String>,
    pub git_url: Option<String>,
}

pub async fn add(
    State(reg): State<ProjectRegistry>,
    Json(b): Json<AddBody>,
) -> Result<(StatusCode, Json<ProjectMeta>), (StatusCode, String)> {
    let meta = match (b.path, b.git_url) {
        (Some(p), None) => reg
            .add_local(std::path::Path::new(&p))
            .await
            .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?,
        (None, Some(url)) => reg
            .add_git(&url)
            .await
            .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                "provide exactly one of `path` or `git_url`".to_string(),
            ))
        }
    };
    Ok((StatusCode::CREATED, Json(meta)))
}

pub async fn remove(
    State(reg): State<ProjectRegistry>,
    Path(pid): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    match reg.remove(&pid).await {
        Ok(true) => Ok(StatusCode::NO_CONTENT),
        Ok(false) => Err((StatusCode::NOT_FOUND, format!("unknown project: {pid}"))),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

#[derive(Deserialize)]
pub struct SaveAsBody {
    pub name: String,
}

pub async fn save_as(
    State(reg): State<ProjectRegistry>,
    Json(b): Json<SaveAsBody>,
) -> Result<(StatusCode, Json<ProjectMeta>), (StatusCode, String)> {
    reg.save_workspace_as(&b.name)
        .await
        .map(|m| (StatusCode::CREATED, Json(m)))
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

/// Global gateway health (no project needed).
pub async fn health() -> Json<Value> {
    Json(json!({ "gateway_ok": true }))
}
