use axum::Json;

use crate::api::scope::Scoped;
use crate::tools::ToolCatalog;

pub async fn list(Scoped(state): Scoped) -> Json<ToolCatalog> {
    Json(state.list_tools())
}
