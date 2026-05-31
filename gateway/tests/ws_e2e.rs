use futures_util::StreamExt;
use std::path::PathBuf;
use tau_gateway::{api, state::AppState, store::RunStore};
use tokio_tungstenite::tungstenite::Message;

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

#[tokio::test]
async fn ws_streams_live_then_closes() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new(bin(), project(), true, RunStore::new(dir.path()).unwrap());
    let app = api::router(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let run_id = state.launch("greeter".into(), "hi".into()).await.unwrap();
    let url = format!("ws://{addr}/api/runs/{run_id}/events");
    let (mut ws, _) = tokio_tungstenite::connect_async(url).await.unwrap();

    let mut saw_snapshot = false;
    let mut saw_terminal = false;
    while let Some(Ok(msg)) = ws.next().await {
        if let Message::Text(ref t) = msg {
            if t.contains("\"type\":\"snapshot\"") {
                saw_snapshot = true;
            }
            if t.contains("\"status\":\"completed\"") {
                saw_terminal = true;
            }
        }
        if let Message::Close(_) = msg {
            break;
        }
    }
    assert!(saw_snapshot, "expected a snapshot message");
    assert!(saw_terminal, "expected a terminal run update");
}
