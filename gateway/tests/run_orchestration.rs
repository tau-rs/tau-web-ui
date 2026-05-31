use std::path::PathBuf;
use tau_gateway::state::AppState;
use tau_gateway::store::RunStore;
use tau_gateway::trace::RunStatus;

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
async fn launch_completes_and_persists() {
    let dir = tempfile::tempdir().unwrap();
    let store = RunStore::new(dir.path()).unwrap();
    let state = AppState::new(bin(), project(), true, store);

    let run_id = state.launch("greeter".into(), "hi".into()).await.unwrap();
    for _ in 0..100 {
        if let Some(run) = state.get_run(&run_id).await {
            if run.status != RunStatus::Running {
                assert_eq!(run.status, RunStatus::Completed);
                assert!(run.token_usage.is_some());
                assert!(run.total_turns.is_some());
                let (r2, spans) = state.load_trace(&run_id).unwrap();
                assert_eq!(r2.status, RunStatus::Completed);
                assert!(spans.iter().any(|s| s.name == "fs-read"));
                return;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    panic!("run did not complete");
}

#[tokio::test]
async fn rehydrate_marks_stale_running_as_failed() {
    let dir = tempfile::tempdir().unwrap();
    let store = RunStore::new(dir.path()).unwrap();
    let run = tau_gateway::trace::Run {
        id: "STALE".into(),
        agent_id: "greeter".into(),
        prompt: "x".into(),
        substrate: tau_gateway::trace::Substrate::Host,
        mode: tau_gateway::trace::Mode::Dev,
        status: RunStatus::Running,
        started_at: "2026-05-31T00:00:00Z".into(),
        ended_at: None,
        total_turns: None,
        token_usage: None,
        stop_reason: None,
        error: None,
        source: tau_gateway::trace::Source::Serve,
    };
    store.write_header(&run).await.unwrap();

    let state = AppState::new(bin(), project(), true, store);
    state.rehydrate().await.unwrap();
    let r = state.get_run("STALE").await.unwrap();
    assert_eq!(r.status, RunStatus::Failed);
}
