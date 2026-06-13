use axum::extract::Path;
use axum::http::StatusCode;
use axum::Json;

use crate::api::scope::Scoped;
use crate::graph::{GraphError, WorkflowGraph};

pub async fn graph(
    Scoped(state): Scoped,
    Path((_pid, name)): Path<(String, String)>,
) -> Result<Json<WorkflowGraph>, (StatusCode, String)> {
    match state.workflow_graph(&name) {
        Ok(g) => Ok(Json(g)),
        Err(e @ GraphError::NotFound(_)) => Err((StatusCode::NOT_FOUND, e.to_string())),
        Err(e @ GraphError::Parse { .. }) => Err((StatusCode::UNPROCESSABLE_ENTITY, e.to_string())),
    }
}
