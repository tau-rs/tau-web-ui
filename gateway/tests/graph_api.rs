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
async fn workflow_graph_over_http() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let meta = reg.add_local(&project()).await.unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();

    let resp = http
        .get(format!(
            "{base}/api/projects/{}/workflows/nightly-research/graph",
            meta.id
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let g: serde_json::Value = resp.json().await.unwrap();

    assert_eq!(g["workflow"], "nightly-research");
    assert_eq!(g["nodes"].as_array().unwrap().len(), 3);
    assert_eq!(g["edges"].as_array().unwrap().len(), 2);

    let nodes = g["nodes"].as_array().unwrap();
    let gather = nodes.iter().find(|n| n["id"] == "gather").unwrap();
    assert_eq!(gather["kind"], "agent.run");
    let save = nodes.iter().find(|n| n["id"] == "save-results").unwrap();
    assert_eq!(save["kind"], "tool.call");

    // composer enrichment: the agent.run node "gather" (agent "researcher", which
    // has no llm_backend in the demo fixture) resolves to the recommended backend
    // (anthropic) and no tools; the tool.call node has a null provider.
    assert_eq!(gather["provider"], "anthropic");
    assert!(gather["tools"].as_array().unwrap().is_empty());
    assert_eq!(save["provider"], serde_json::Value::Null);
}

#[tokio::test]
async fn unknown_workflow_mock_returns_empty_graph() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let meta = reg.add_local(&project()).await.unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();

    // Real CliGraph path requires a non-mock bin; the demo fixture is served
    // by the mock here, so unknown names resolve to an empty graph (200).
    // This test pins the *mock* contract: unknown name → 200 empty graph.
    let resp = http
        .get(format!(
            "{base}/api/projects/{}/workflows/does-not-exist/graph",
            meta.id
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let g: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(g["nodes"].as_array().unwrap().len(), 0);
}
