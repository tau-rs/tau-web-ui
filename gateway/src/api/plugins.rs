use axum::Json;

use crate::api::scope::Scoped;
use crate::plugins::PluginCatalog;

pub async fn list(Scoped(state): Scoped) -> Json<PluginCatalog> {
    Json(state.list_plugins())
}
