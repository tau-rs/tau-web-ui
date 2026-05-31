use std::path::PathBuf;
use tau_gateway::serve_client::{RunItem, ServeClient};

fn mock_bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop(); // gateway -> workspace root
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
async fn handshake_lists_agents() {
    let client = ServeClient::spawn(mock_bin(), project(), true)
        .await
        .unwrap();
    let hs = client.handshake().await;
    assert!(hs.agents.contains(&"greeter".to_string()));
    assert!(client.ping().await.unwrap());
}

#[tokio::test]
async fn streaming_run_emits_events_then_final() {
    let client = ServeClient::spawn(mock_bin(), project(), true)
        .await
        .unwrap();
    let (_id, mut rx) = client.run_streaming("greeter", "hi").await.unwrap();
    let mut kinds = vec![];
    let mut got_final = false;
    while let Some(item) = rx.recv().await {
        match item {
            RunItem::Event { kind, .. } => kinds.push(kind),
            RunItem::Final { stop_reason, .. } => {
                got_final = true;
                assert_eq!(stop_reason, "end_turn");
                break;
            }
            RunItem::Error(e) => panic!("unexpected error {e:?}"),
        }
    }
    assert!(got_final);
    assert!(kinds.contains(&"TextDelta".to_string()));
    assert!(kinds.contains(&"ToolCallStarted".to_string()));
    assert!(kinds.contains(&"RunCompleted".to_string()));
}

#[tokio::test]
async fn cancel_mid_run_yields_error() {
    let client = ServeClient::spawn(mock_bin(), project(), true)
        .await
        .unwrap();
    let (id, mut rx) = client.run_streaming("greeter", "hi").await.unwrap();
    assert!(client.cancel(id).await.unwrap());
    let mut saw_error = false;
    while let Some(item) = rx.recv().await {
        if let RunItem::Error(e) = item {
            assert_eq!(e.code, -32001);
            saw_error = true;
            break;
        }
        if let RunItem::Final { .. } = item {
            break;
        }
    }
    assert!(saw_error, "expected -32001 cancellation");
}
