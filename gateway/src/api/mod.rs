//! HTTP/WS API surface. Per-project routes are nested under `/api/projects/{pid}`
//! and resolve their `AppState` via the `Scoped` extractor; global routes operate
//! on the `ProjectRegistry` directly.
pub mod agents;
pub mod checks;
pub mod config;
pub mod credentials;
pub mod graph;
pub mod guard;
pub mod meta;
pub mod packages;
pub mod plugins;
pub mod projects;
pub mod providers;
pub mod runs;
pub mod scope;
pub mod ship;
pub mod skills;
pub mod tools;
pub mod workflows;
pub mod ws;

use crate::projects::ProjectRegistry;
use axum::{
    middleware,
    routing::{delete, get, post, put},
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
        .route("/workflows/{name}/graph", get(graph::graph))
        .route("/packages", get(packages::list))
        .route("/packages/install", post(packages::install))
        .route("/packages/resolve", post(packages::resolve))
        .route("/packages/verify", post(packages::verify))
        .route("/packages/{name}", delete(packages::uninstall))
        .route("/packages/{name}/update", post(packages::update))
        .route("/providers", get(providers::list))
        .route("/agents", get(agents::list))
        .route("/agents/import", post(agents::import))
        .route(
            "/agents/{id}",
            get(agents::get_one).put(agents::put).delete(agents::remove),
        )
        .route("/skills", get(skills::list))
        .route("/skills/import", post(skills::import))
        .route(
            "/skills/{name}",
            get(skills::get_one).put(skills::put).delete(skills::remove),
        )
        .route("/tools", get(tools::list))
        .route("/plugins", get(plugins::list))
        .route("/targets", get(ship::targets))
        .route("/bundles", get(ship::bundles))
        .route("/build", post(ship::build))
        .route("/verify", post(ship::verify))
        .route("/checks", get(checks::report));

    Router::new()
        .route("/api/health", get(projects::health))
        .route("/api/projects", get(projects::list).post(projects::add))
        .route("/api/projects/runs", get(projects::cross_runs))
        .route("/api/workspace/save-as", post(projects::save_as))
        .route("/api/credentials", get(credentials::list))
        .route(
            "/api/credentials/{backend}",
            put(credentials::put).delete(credentials::remove),
        )
        .nest("/api/projects/{pid}", scoped)
        .with_state(reg)
        // Outermost layer: runs before routing/extractors, so it guards every
        // HTTP route and the WS upgrade against CSRF / DNS-rebinding (audit S1).
        .layer(middleware::from_fn(guard::loopback_guard))
}
