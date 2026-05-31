//! Maps handoff spec §3.6 acceptance criteria to assertions (gateway side).
//! AC#9 (visual/manual) is covered in Plan 2.

use std::path::PathBuf;
use std::time::Duration;
use tau_gateway::{state::AppState, store::RunStore, trace::RunStatus};

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

async fn wait_terminal(state: &AppState, id: &str) -> RunStatus {
    for _ in 0..200 {
        if let Some(r) = state.get_run(id).await {
            if r.status != RunStatus::Running {
                return r.status;
            }
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("run {id} never reached terminal");
}

#[tokio::test]
async fn ac1_project_lists_agents() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new(bin(), project(), true, RunStore::new(dir.path()).unwrap());
    let hs = state.handshake().await.unwrap();
    assert!(hs.agents.contains(&"greeter".to_string())); // AC#1
}

#[tokio::test]
async fn ac3_4_tool_span_and_final_usage() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new(bin(), project(), true, RunStore::new(dir.path()).unwrap());
    let id = state.launch("greeter".into(), "hi".into()).await.unwrap();
    assert_eq!(wait_terminal(&state, &id).await, RunStatus::Completed);
    let (run, spans) = state.load_trace(&id).unwrap();
    let tool = spans
        .iter()
        .find(|s| s.name == "fs-read")
        .expect("fs-read span");
    assert!(tool.attributes.get("result").is_some());
    assert!(run.total_turns.is_some());
    assert!(run.token_usage.is_some());
}

#[tokio::test]
async fn ac5_replay_matches() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new(bin(), project(), true, RunStore::new(dir.path()).unwrap());
    let id = state
        .launch("researcher".into(), "topic".into())
        .await
        .unwrap();
    wait_terminal(&state, &id).await;
    let (_r1, s1) = state.load_trace(&id).unwrap();
    let state2 = AppState::new(bin(), project(), true, RunStore::new(dir.path()).unwrap());
    state2.rehydrate().await.unwrap();
    let (_r2, s2) = state2.load_trace(&id).unwrap();
    assert_eq!(s1.len(), s2.len());
    assert!(s1.iter().any(|s| s.name == "agent.summarizer.spawn"));
}

#[tokio::test]
async fn ac6_cancel_transitions_to_cancelled() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new(bin(), project(), true, RunStore::new(dir.path()).unwrap());
    let id = state.launch("greeter".into(), "hi".into()).await.unwrap();
    tokio::time::sleep(Duration::from_millis(20)).await;
    state.cancel(&id).await.unwrap();
    assert_eq!(wait_terminal(&state, &id).await, RunStatus::Cancelled); // AC#6
}

#[tokio::test]
async fn ac7_child_death_recovers_next_launch() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new(bin(), project(), true, RunStore::new(dir.path()).unwrap());
    let id1 = state.launch("greeter".into(), "hi".into()).await.unwrap();
    wait_terminal(&state, &id1).await;
    // Relaunch must succeed (proves the client is reusable / respawnable).
    let id2 = state.launch("greeter".into(), "hi".into()).await.unwrap();
    assert_eq!(wait_terminal(&state, &id2).await, RunStatus::Completed);
}
