use axum::{
    extract::{Path, Query},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::scope::Scoped;
use crate::config::AgentDetail;

fn valid_agent_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub async fn list(Scoped(state): Scoped) -> Result<Json<Vec<AgentDetail>>, (StatusCode, String)> {
    state
        .list_agents()
        .map(Json)
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

pub async fn get_one(
    Scoped(state): Scoped,
    Path((_pid, id)): Path<(String, String)>,
) -> Result<Json<AgentDetail>, (StatusCode, String)> {
    match state.read_agent(&id) {
        Ok(Some(a)) => Ok(Json(a)),
        Ok(None) => Err((StatusCode::NOT_FOUND, format!("unknown agent: {id}"))),
        Err(e) => Err((StatusCode::BAD_GATEWAY, e.to_string())),
    }
}

#[derive(Deserialize)]
pub struct PutQuery {
    pub create: Option<String>,
}

pub async fn put(
    Scoped(state): Scoped,
    Path((_pid, id)): Path<(String, String)>,
    Query(q): Query<PutQuery>,
    Json(mut body): Json<AgentDetail>,
) -> Result<Json<AgentDetail>, (StatusCode, String)> {
    if !valid_agent_id(&id) {
        return Err((StatusCode::BAD_REQUEST, format!("invalid agent id: {id}")));
    }
    if body.prompt.system.is_some() && body.prompt.system_file.is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            "prompt: set at most one of system / system_file".to_string(),
        ));
    }
    let create = q.create.as_deref() == Some("1");
    if create {
        match state.read_agent(&id) {
            Ok(Some(_)) => {
                return Err((StatusCode::CONFLICT, format!("agent already exists: {id}")))
            }
            Err(e) => return Err((StatusCode::BAD_GATEWAY, e.to_string())),
            Ok(None) => {}
        }
    }
    body.id = id; // URL id is authoritative
    state
        .write_agent(&body)
        .map(|_| Json(body))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

pub async fn remove(
    Scoped(state): Scoped,
    Path((_pid, id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, String)> {
    match state.delete_agent(&id) {
        Ok(true) => Ok(StatusCode::NO_CONTENT),
        Ok(false) => Err((StatusCode::NOT_FOUND, format!("unknown agent: {id}"))),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

#[derive(Deserialize)]
pub struct ImportBody {
    pub git_url: String,
    pub llm_backend: String,
}

pub async fn import(
    Scoped(state): Scoped,
    Json(b): Json<ImportBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .import_agent(&b.git_url, &b.llm_backend)
        .map(|id| Json(json!({ "agent_id": id })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}
