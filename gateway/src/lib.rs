//! tau-gateway: local service fronting `tau serve` behind a stable HTTP+WS API.
pub mod adapters;
pub mod api;
pub mod serve_client;
pub mod state;
pub mod store;
pub mod trace;
pub mod workflow;
