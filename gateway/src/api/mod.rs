//! HTTP/WS API surface (handoff spec §3.2).
pub mod agents;
pub mod config;
pub mod meta;
pub mod packages;
pub mod runs;
pub mod workflows;
pub mod ws;

use crate::state::AppState;
use axum::{
    routing::{delete, get, post},
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
        .route("/api/project/config", get(config::get).put(config::put))
        .route("/api/packages", get(packages::list))
        .route("/api/packages/install", post(packages::install))
        .route("/api/packages/resolve", post(packages::resolve))
        .route("/api/packages/verify", post(packages::verify))
        .route("/api/packages/:name", delete(packages::uninstall))
        .route("/api/packages/:name/update", post(packages::update))
        .route("/api/agents/import", post(agents::import))
        .with_state(state)
}
