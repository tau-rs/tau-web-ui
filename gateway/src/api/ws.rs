//! WS endpoint (implemented in Task 11).
use axum::{extract::{Path, State}, response::IntoResponse, http::StatusCode};
use crate::state::AppState;

pub async fn ws_handler(State(_): State<AppState>, Path(_): Path<String>) -> impl IntoResponse {
    StatusCode::NOT_IMPLEMENTED
}
