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
async fn ship_targets_bundles_and_build() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let meta = reg.add_local(&project()).await.unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();

    // targets
    let targets: serde_json::Value = http
        .get(format!("{base}/api/projects/{}/targets", meta.id))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let tarr = targets.as_array().unwrap();
    assert_eq!(tarr.len(), 4);
    let darwin = tarr
        .iter()
        .find(|t| t["triple"] == "darwin-native-strict")
        .unwrap();
    assert_eq!(darwin["status"], "available");

    // bundles (seeded, non-empty)
    let bundles: serde_json::Value = http
        .get(format!("{base}/api/projects/{}/bundles", meta.id))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(!bundles.as_array().unwrap().is_empty());

    // build an available target → 200 with a bundle path
    let resp = http
        .post(format!("{base}/api/projects/{}/build", meta.id))
        .json(&serde_json::json!({ "target": "darwin-native-strict" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let built: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(built["path"], "demo.tau");

    // build a reserved target → 400
    let bad = http
        .post(format!("{base}/api/projects/{}/build", meta.id))
        .json(&serde_json::json!({ "target": "windows-native-strict" }))
        .send()
        .await
        .unwrap();
    assert_eq!(bad.status(), reqwest::StatusCode::BAD_REQUEST);
}
