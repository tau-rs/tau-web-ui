use axum::Json;

use crate::api::scope::Scoped;
use crate::checks::CheckReport;

pub async fn report(Scoped(state): Scoped) -> Json<CheckReport> {
    Json(state.checks())
}
