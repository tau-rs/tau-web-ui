use std::path::PathBuf;

use tau_gateway::{api, projects::ProjectRegistry};

fn bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}
fn project() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("fixtures/demo");
    p
}

async fn serve(reg: ProjectRegistry) -> String {
    let app = api::router(reg);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn sessions_list_show_export_over_http() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let meta = reg.add_local(&project()).await.unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();
    let pid = meta.id;

    // LIST — three seeded mock sessions
    let rows: serde_json::Value = http
        .get(format!("{base}/api/projects/{pid}/sessions"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(rows.as_array().unwrap().len(), 3);

    // SHOW (exact id) — 200 with envelope
    let detail: serde_json::Value = http
        .get(format!(
            "{base}/api/projects/{pid}/sessions/018f5a2c-0000-0000-0000-000000000001"
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(detail["header"]["agent_id"], "coder");
    assert!(detail["messages"].is_array());

    // SHOW (ambiguous prefix) — 409
    let amb = http
        .get(format!("{base}/api/projects/{pid}/sessions/018f5a2c"))
        .send()
        .await
        .unwrap();
    assert_eq!(amb.status(), reqwest::StatusCode::CONFLICT);

    // SHOW (no match) — 404
    let missing = http
        .get(format!("{base}/api/projects/{pid}/sessions/ffffffff"))
        .send()
        .await
        .unwrap();
    assert_eq!(missing.status(), reqwest::StatusCode::NOT_FOUND);

    // SHOW (bad id) — 400
    let bad = http
        .get(format!("{base}/api/projects/{pid}/sessions/short"))
        .send()
        .await
        .unwrap();
    assert_eq!(bad.status(), reqwest::StatusCode::BAD_REQUEST);

    // EXPORT (md) — download headers + body
    let exp = http
        .get(format!(
            "{base}/api/projects/{pid}/sessions/02b13f99/export?format=md"
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(exp.status(), reqwest::StatusCode::OK);
    assert!(exp
        .headers()
        .get("content-disposition")
        .unwrap()
        .to_str()
        .unwrap()
        .contains("session-02b13f99.md"));

    // EXPORT (bad format) — 400
    let badfmt = http
        .get(format!(
            "{base}/api/projects/{pid}/sessions/02b13f99/export?format=xml"
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(badfmt.status(), reqwest::StatusCode::BAD_REQUEST);
}
