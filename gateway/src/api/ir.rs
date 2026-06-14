use axum::http::StatusCode;
use axum::Json;

use crate::api::scope::Scoped;
use crate::ir::{CompiledIr, IrError};

pub async fn compiled(Scoped(state): Scoped) -> Result<Json<CompiledIr>, (StatusCode, String)> {
    match state.compiled_ir() {
        Ok(ir) => Ok(Json(ir)),
        Err(e @ IrError::NotCompiled(_)) => Err((StatusCode::UNPROCESSABLE_ENTITY, e.to_string())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}
