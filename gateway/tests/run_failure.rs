use std::path::PathBuf;
use std::time::Duration;
use tau_gateway::projects::ProjectRegistry;
use tau_gateway::trace::RunStatus;

fn mock_bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}

#[tokio::test]
async fn llm_error_maps_to_failed_run_with_detail() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load_with_kind(mock_bin(), true, data.path().to_path_buf(), Some(true))
        .await
        .unwrap();
    let state = reg.state(tau_gateway::projects::WORKSPACE_ID).await.unwrap();

    let run_id = state.launch("boom".into(), "go".into()).await.unwrap();

    // Poll the in-memory run until terminal (the stream task finalizes async).
    let mut run = None;
    for _ in 0..50 {
        let r = state.get_run(&run_id).await.unwrap();
        if r.status != RunStatus::Running {
            run = Some(r);
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let run = run.expect("run reached a terminal state");
    assert_eq!(run.status, RunStatus::Failed);
    let err = run.error.expect("failed run carries an error");
    assert!(err.detail.contains("boom"), "detail was: {}", err.detail);
}
