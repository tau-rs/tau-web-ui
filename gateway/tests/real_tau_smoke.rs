//! Smoke test against a REAL `tau serve` + Ollama. Skips unless BOTH:
//!   - env `TAU_REAL_BIN` points at a runnable `tau` binary, and
//!   - Ollama answers at http://localhost:11434.
//!
//! Never runs in the default CI gate (no model in CI).

use std::path::PathBuf;
use tau_gateway::serve_client::{RunItem, ServeClient};

fn real_bin() -> Option<PathBuf> {
    std::env::var("TAU_REAL_BIN")
        .ok()
        .map(PathBuf::from)
        .filter(|p| p.exists())
}

fn fixture() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("fixtures/ollama-smoke");
    p
}

async fn ollama_up() -> bool {
    tokio::net::TcpStream::connect("127.0.0.1:11434")
        .await
        .is_ok()
}

#[tokio::test]
async fn real_tau_ollama_streams_a_completed_run() {
    let Some(bin) = real_bin() else {
        eprintln!("skip: set TAU_REAL_BIN to a runnable tau binary");
        return;
    };
    if !ollama_up().await {
        eprintln!("skip: Ollama not reachable on :11434");
        return;
    }

    let client = ServeClient::spawn(bin, fixture(), true).await.unwrap();
    let hs = client.handshake().await;
    assert!(
        hs.agents.iter().any(|a| a == "local"),
        "agents: {:?}",
        hs.agents
    );

    let (_id, mut rx) = client
        .run_streaming("local", "Say hello in one short sentence.")
        .await
        .unwrap();
    let mut saw_text = false;
    let mut completed = false;
    while let Some(item) = rx.recv().await {
        match item {
            RunItem::Event { kind, .. } if kind == "TextDelta" => saw_text = true,
            RunItem::Final { .. } => {
                completed = true;
                break;
            }
            RunItem::Error(e) => panic!("run errored: {} {}", e.code, e.message),
            _ => {}
        }
    }
    assert!(saw_text, "expected at least one TextDelta from the model");
    assert!(completed, "expected a final result");
}
