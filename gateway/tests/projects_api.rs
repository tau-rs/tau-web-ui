use std::path::PathBuf;
use tau_gateway::{api, projects::ProjectRegistry};

fn bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}

fn make_project(name: &str) -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    std::fs::write(
        d.path().join("tau.toml"),
        format!("[project]\nname = \"{name}\"\n\n[agents.greeter]\ndisplay_name = \"Greeter\"\nllm_backend = \"anthropic\"\n"),
    )
    .unwrap();
    d
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
async fn global_list_and_scoped_404() {
    let data = tempfile::tempdir().unwrap();
    let proj = make_project("demo");
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    reg.add_local(proj.path()).await.unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();

    // global list returns the project with a summary
    let items: serde_json::Value = http
        .get(format!("{base}/api/projects"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let arr = items.as_array().unwrap();
    // workspace is always present; assert the demo project is there alongside it.
    let demo = arr
        .iter()
        .find(|p| p["meta"]["id"] == "demo")
        .expect("demo project present");
    assert!(demo["summary"]["agents"].as_u64().unwrap() >= 1);
    assert!(arr
        .iter()
        .any(|p| p["meta"]["source"]["kind"] == "workspace"));

    // scoped route on a known project works
    let cfg = http
        .get(format!("{base}/api/projects/demo/project/config"))
        .send()
        .await
        .unwrap();
    assert!(cfg.status().is_success());

    // scoped route on an unknown project is 404
    let missing = http
        .get(format!("{base}/api/projects/nope/project/config"))
        .send()
        .await
        .unwrap();
    assert_eq!(missing.status(), reqwest::StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn add_and_remove_over_http() {
    let data = tempfile::tempdir().unwrap();
    let proj = make_project("demo");
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();

    let created = http
        .post(format!("{base}/api/projects"))
        .json(&serde_json::json!({ "path": proj.path().to_string_lossy() }))
        .send()
        .await
        .unwrap();
    assert_eq!(created.status(), reqwest::StatusCode::CREATED);
    let meta: serde_json::Value = created.json().await.unwrap();
    assert_eq!(meta["id"], "demo");

    let del = http
        .delete(format!("{base}/api/projects/demo"))
        .send()
        .await
        .unwrap();
    assert_eq!(del.status(), reqwest::StatusCode::NO_CONTENT);
}
