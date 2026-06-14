use axum::{
    extract::{Path, Query},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;

use crate::api::scope::Scoped;
use crate::sessions::{ExportFormat, SessionDetail, SessionError, SessionSummary};

fn map_err(e: SessionError) -> (StatusCode, String) {
    match e {
        SessionError::NotFound(m) => (StatusCode::NOT_FOUND, m),
        SessionError::AmbiguousPrefix(c) => (
            StatusCode::CONFLICT,
            format!("ambiguous session id; candidates: {}", c.join(", ")),
        ),
        SessionError::BadFormat(m) => (StatusCode::BAD_REQUEST, m),
        SessionError::MalformedOutput(m) => (StatusCode::BAD_GATEWAY, m),
        SessionError::Tau(m) => (StatusCode::BAD_GATEWAY, m),
    }
}

pub async fn list(
    Scoped(state): Scoped,
) -> Result<Json<Vec<SessionSummary>>, (StatusCode, String)> {
    state.list_sessions().map(Json).map_err(map_err)
}

pub async fn get_one(
    Scoped(state): Scoped,
    Path((_pid, id)): Path<(String, String)>,
) -> Result<Json<SessionDetail>, (StatusCode, String)> {
    state.show_session(&id).map(Json).map_err(map_err)
}

#[derive(Deserialize)]
pub struct ExportQuery {
    pub format: Option<String>,
}

pub async fn export(
    Scoped(state): Scoped,
    Path((_pid, id)): Path<(String, String)>,
    Query(q): Query<ExportQuery>,
) -> Result<Response, (StatusCode, String)> {
    let fmt = ExportFormat::parse(q.format.as_deref().unwrap_or("jsonl")).map_err(map_err)?;
    let bytes = state.export_session(&id, fmt).map_err(map_err)?;
    let prefix: String = id.chars().take(8).collect();
    Ok((
        [
            (header::CONTENT_TYPE, fmt.content_type().to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"session-{prefix}.{}\"", fmt.ext()),
            ),
        ],
        bytes,
    )
        .into_response())
}
