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
async fn plugins_list_over_http() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let meta = reg.add_local(&project()).await.unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();

    let resp = http
        .get(format!("{base}/api/projects/{}/plugins", meta.id))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let list: serde_json::Value = resp.json().await.unwrap();
    let arr = list.as_array().unwrap();
    assert_eq!(arr.len(), 4);

    let fsr = arr.iter().find(|p| p["name"] == "fs-read").unwrap();
    assert_eq!(fsr["port"], "Tool");
    assert_eq!(fsr["describe"]["port"], "Tool");
    assert!(!fsr["transcript"].as_array().unwrap().is_empty());

    let anthropic = arr.iter().find(|p| p["name"] == "anthropic").unwrap();
    assert_eq!(anthropic["port"], "LlmBackend");
    assert!(anthropic["transcript"]
        .as_array()
        .unwrap()
        .iter()
        .any(|f| f["method"] == "llm.generate"));
}
