//! HTTP/WS API surface. Per-project routes are nested under `/api/projects/{pid}`
//! and resolve their `AppState` via the `Scoped` extractor; global routes operate
//! on the `ProjectRegistry` directly.
pub mod agents;
pub mod config;
pub mod meta;
pub mod packages;
pub mod projects;
pub mod runs;
pub mod scope;
pub mod workflows;
pub mod ws;

use crate::projects::ProjectRegistry;
use axum::{
    routing::{delete, get, post},
    Router,
};

pub fn router(reg: ProjectRegistry) -> Router {
    let scoped = Router::new()
        .route("/", delete(projects::remove))
        .route("/health", get(meta::health))
        .route("/project", get(meta::project))
        .route("/project/config", get(config::get).put(config::put))
        .route("/runs", post(runs::launch).get(runs::list))
        .route("/runs/{id}", get(runs::get_one))
        .route("/runs/{id}/cancel", post(runs::cancel))
        .route("/runs/{id}/events", get(ws::ws_handler))
        .route("/workflows", get(workflows::list))
        .route("/workflows/run", post(workflows::run))
        .route("/packages", get(packages::list))
        .route("/packages/install", post(packages::install))
        .route("/packages/resolve", post(packages::resolve))
        .route("/packages/verify", post(packages::verify))
        .route("/packages/{name}", delete(packages::uninstall))
        .route("/packages/{name}/update", post(packages::update))
        .route("/agents", get(agents::list))
        .route("/agents/import", post(agents::import))
        .route(
            "/agents/{id}",
            get(agents::get_one).put(agents::put).delete(agents::remove),
        );

    Router::new()
        .route("/api/health", get(projects::health))
        .route("/api/projects", get(projects::list).post(projects::add))
        .route("/api/projects/runs", get(projects::cross_runs))
        .nest("/api/projects/{pid}", scoped)
        .with_state(reg)
}
