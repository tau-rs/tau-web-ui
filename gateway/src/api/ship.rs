use axum::{http::StatusCode, Json};

use crate::api::scope::Scoped;
use crate::ship::{Bundle, BuildRequest, Target};

pub async fn targets(Scoped(state): Scoped) -> Json<Vec<Target>> {
    Json(state.list_targets())
}

pub async fn bundles(Scoped(state): Scoped) -> Json<Vec<Bundle>> {
    Json(state.list_bundles())
}

pub async fn build(
    Scoped(state): Scoped,
    Json(req): Json<BuildRequest>,
) -> Result<Json<Bundle>, (StatusCode, String)> {
    state
        .build(&req.target)
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}
