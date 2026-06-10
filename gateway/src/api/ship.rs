use axum::{http::StatusCode, Json};

use crate::api::scope::Scoped;
use crate::ship::{BuildRequest, Bundle, Target, VerifyOutcome, VerifyRequest};

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

pub async fn verify(
    Scoped(state): Scoped,
    Json(req): Json<VerifyRequest>,
) -> Result<Json<VerifyOutcome>, (StatusCode, String)> {
    state
        .verify(&req.path)
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}
