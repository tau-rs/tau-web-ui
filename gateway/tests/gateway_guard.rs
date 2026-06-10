//! Integration coverage for the loopback Origin/Host guard (audit S1).
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

async fn serve() -> (String, std::net::SocketAddr) {
    let (base, addr, _reg) = serve_with_reg().await;
    (base, addr)
}

/// Like `serve`, but also returns the registry so tests can register a project
/// and launch a run (needed to exercise the WS upgrade end-to-end).
async fn serve_with_reg() -> (String, std::net::SocketAddr, ProjectRegistry) {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    // Keep the tempdir alive for the lifetime of the test process.
    std::mem::forget(data);
    let app = api::router(reg.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{addr}"), addr, reg)
}

#[tokio::test]
async fn foreign_origin_rejected_on_sensitive_route() {
    let (base, _) = serve().await;
    let res = reqwest::Client::new()
        .post(format!("{base}/api/projects"))
        .header("origin", "http://evil.com")
        .json(&serde_json::json!({ "path": "/tmp/whatever" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn foreign_host_rejected() {
    let (base, _) = serve().await;
    // Simulate DNS-rebinding: connect to loopback but send a foreign Host header.
    let res = reqwest::Client::new()
        .get(format!("{base}/api/projects"))
        .header("host", "evil.com")
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn loopback_origin_allowed() {
    let (base, _) = serve().await;
    let res = reqwest::Client::new()
        .get(format!("{base}/api/projects"))
        .header("origin", "http://127.0.0.1:5173")
        .send()
        .await
        .unwrap();
    assert!(res.status().is_success(), "got {}", res.status());
}

#[tokio::test]
async fn ws_upgrade_foreign_origin_rejected_but_loopback_allowed() {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let (_, addr, reg) = serve_with_reg().await;
    // A real project + run, so the upgrade would otherwise succeed — the only
    // reason a foreign-origin handshake fails is the guard.
    let meta = reg.add_local(&project()).await.unwrap();
    let state = reg.state(&meta.id).await.unwrap();
    let run_id = state.launch("greeter".into(), "hi".into()).await.unwrap();
    let url = format!("ws://{addr}/api/projects/{}/runs/{run_id}/events", meta.id);

    // Foreign Origin -> handshake rejected.
    let mut foreign = url.clone().into_client_request().unwrap();
    foreign
        .headers_mut()
        .insert("origin", "http://evil.com".parse().unwrap());
    assert!(
        tokio_tungstenite::connect_async(foreign).await.is_err(),
        "expected the foreign-origin WS handshake to be rejected"
    );

    // Loopback Origin -> handshake accepted (legit UI still works).
    let mut local = url.into_client_request().unwrap();
    local
        .headers_mut()
        .insert("origin", "http://127.0.0.1:5173".parse().unwrap());
    assert!(
        tokio_tungstenite::connect_async(local).await.is_ok(),
        "expected the loopback-origin WS handshake to succeed"
    );
}
