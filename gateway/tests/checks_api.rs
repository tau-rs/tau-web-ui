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
async fn checks_report_over_http() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let meta = reg.add_local(&project()).await.unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();

    let resp = http
        .get(format!("{base}/api/projects/{}/checks", meta.id))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let report: serde_json::Value = resp.json().await.unwrap();

    assert_eq!(report["categories"].as_array().unwrap().len(), 6);
    assert_eq!(report["findings"].as_array().unwrap().len(), 3);
    assert_eq!(report["sandbox"]["tier"], "seatbelt");

    let config = report["categories"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "config")
        .unwrap();
    assert_eq!(config["errors"], 1);

    let err = report["findings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["severity"] == "error")
        .unwrap();
    assert_eq!(err["rule"], "TAU-CONFIG-ENDPOINT");
}
