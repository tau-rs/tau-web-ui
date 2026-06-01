use axum::{
    extract::{Path, Query},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::scope::Scoped;
use crate::skills::{valid_skill_name, SkillDetail, SkillSummary};

pub async fn list(Scoped(state): Scoped) -> Json<Vec<SkillSummary>> {
    Json(state.list_skills())
}

pub async fn get_one(
    Scoped(state): Scoped,
    Path((_pid, name)): Path<(String, String)>,
) -> Result<Json<SkillDetail>, (StatusCode, String)> {
    if !valid_skill_name(&name) {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("invalid skill name: {name}"),
        ));
    }
    match state.read_skill(&name) {
        Ok(Some(s)) => Ok(Json(s)),
        Ok(None) => Err((StatusCode::NOT_FOUND, format!("unknown skill: {name}"))),
        Err(e) => Err((StatusCode::BAD_GATEWAY, e.to_string())),
    }
}

#[derive(Deserialize)]
pub struct PutQuery {
    pub create: Option<String>,
}

pub async fn put(
    Scoped(state): Scoped,
    Path((_pid, name)): Path<(String, String)>,
    Query(q): Query<PutQuery>,
    Json(mut body): Json<SkillDetail>,
) -> Result<Json<SkillDetail>, (StatusCode, String)> {
    if !valid_skill_name(&name) {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("invalid skill name: {name}"),
        ));
    }
    let existing = state
        .read_skill(&name)
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    if let Some(s) = &existing {
        if !s.editable {
            return Err((
                StatusCode::CONFLICT,
                "installed skills are read-only".into(),
            ));
        }
    }
    if q.create.as_deref() == Some("1") && existing.is_some() {
        return Err((
            StatusCode::CONFLICT,
            format!("skill already exists: {name}"),
        ));
    }
    body.name = name;
    state
        .write_skill(&body)
        .map(|_| Json(body))
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

pub async fn remove(
    Scoped(state): Scoped,
    Path((_pid, name)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, String)> {
    if !valid_skill_name(&name) {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("invalid skill name: {name}"),
        ));
    }
    match state.read_skill(&name) {
        Ok(Some(s)) if !s.editable => Err((
            StatusCode::BAD_REQUEST,
            "installed skills cannot be deleted".into(),
        )),
        Ok(Some(_)) => match state.delete_skill(&name) {
            Ok(true) => Ok(StatusCode::NO_CONTENT),
            Ok(false) => Err((StatusCode::NOT_FOUND, format!("unknown skill: {name}"))),
            Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
        },
        Ok(None) => Err((StatusCode::NOT_FOUND, format!("unknown skill: {name}"))),
        Err(e) => Err((StatusCode::BAD_GATEWAY, e.to_string())),
    }
}

#[derive(Deserialize)]
pub struct ImportBody {
    pub git_url: String,
}

pub async fn import(
    Scoped(state): Scoped,
    Json(b): Json<ImportBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .import_skill(&b.git_url)
        .map(|name| Json(json!({ "skill": name })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}
