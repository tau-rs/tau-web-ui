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
async fn skill_crud_over_http() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let meta = reg.add_local(&project()).await.unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();
    let pid = meta.id;

    let list: serde_json::Value = http
        .get(format!("{base}/api/projects/{pid}/skills"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let names: Vec<String> = list
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["name"].as_str().unwrap().to_string())
        .collect();
    assert!(names.contains(&"critic".to_string()));
    assert!(names.contains(&"web-search".to_string()));

    // installed skill is read-only: PUT → 409
    let ro = http
        .put(format!("{base}/api/projects/{pid}/skills/web-search"))
        .json(&serde_json::json!({
            "name":"web-search","description":null,"version":null,"source":"x",
            "editable":false,"content":"","capabilities":[],"requires_tools":[],"requires_skills":[]
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(ro.status(), reqwest::StatusCode::CONFLICT);

    let body = serde_json::json!({
        "name":"mytool","description":"d","version":"0.1.0","source":"x","editable":true,
        "content":"hi","capabilities":[{"kind":"fs.read","fields":{"paths":["/tmp/**"]}}],
        "requires_tools":[],"requires_skills":[]
    });
    let created = http
        .put(format!("{base}/api/projects/{pid}/skills/mytool?create=1"))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(created.status(), reqwest::StatusCode::OK);

    let dup = http
        .put(format!("{base}/api/projects/{pid}/skills/mytool?create=1"))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(dup.status(), reqwest::StatusCode::CONFLICT);

    let one: serde_json::Value = http
        .get(format!("{base}/api/projects/{pid}/skills/mytool"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(one["capabilities"][0]["kind"], "fs.read");

    let del = http
        .delete(format!("{base}/api/projects/{pid}/skills/mytool"))
        .send()
        .await
        .unwrap();
    assert_eq!(del.status(), reqwest::StatusCode::NO_CONTENT);
}
