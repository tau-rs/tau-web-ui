//! HTTP/WS API surface (handoff spec §3.2).
pub mod meta;
pub mod runs;
pub mod workflows;
pub mod ws;

use crate::state::AppState;
use axum::{
    routing::{get, post},
    Router,
};

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(meta::health))
        .route("/api/project", get(meta::project))
        .route("/api/runs", post(runs::launch).get(runs::list))
        .route("/api/runs/:id", get(runs::get_one))
        .route("/api/runs/:id/cancel", post(runs::cancel))
        .route("/api/runs/:id/events", get(ws::ws_handler))
        .route("/api/workflows", get(workflows::list))
        .route("/api/workflows/run", post(workflows::run))
        .with_state(state)
}
