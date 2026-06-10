//! `Scoped` extractor: resolves the `:pid` path param against the
//! `ProjectRegistry` router state into that project's `AppState` (404 if unknown).

use std::collections::HashMap;

use axum::{
    extract::{FromRequestParts, Path},
    http::{request::Parts, StatusCode},
};

use crate::projects::ProjectRegistry;
use crate::state::AppState;

pub struct Scoped(pub AppState);

impl FromRequestParts<ProjectRegistry> for Scoped {
    type Rejection = (StatusCode, String);

    async fn from_request_parts(
        parts: &mut Parts,
        reg: &ProjectRegistry,
    ) -> Result<Self, Self::Rejection> {
        let params = Path::<HashMap<String, String>>::from_request_parts(parts, reg)
            .await
            .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
        let pid = params
            .get("pid")
            .ok_or((StatusCode::BAD_REQUEST, "missing project id".to_string()))?;
        match reg.state(pid).await {
            Some(state) => Ok(Scoped(state)),
            None => Err((StatusCode::NOT_FOUND, format!("unknown project: {pid}"))),
        }
    }
}
