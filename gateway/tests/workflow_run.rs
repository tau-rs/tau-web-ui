use std::path::PathBuf;
use std::time::Duration;
use tau_gateway::{state::AppState, store::RunStore, trace::RunStatus, trace::Source};

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
async fn lists_workflow_fixtures() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new(bin(), project(), true, RunStore::new(dir.path()).unwrap());
    let wfs = state.list_workflows();
    assert!(wfs.contains(&"nightly-research".to_string()));
    assert!(wfs.contains(&"build-report".to_string()));
}

#[tokio::test]
async fn launch_workflow_persists_step_spans() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new(bin(), project(), true, RunStore::new(dir.path()).unwrap());
    let id = state
        .launch_workflow("nightly-research".into(), "topic".into())
        .await
        .unwrap();
    let mut status = RunStatus::Running;
    for _ in 0..200 {
        if let Some(r) = state.get_run(&id).await {
            if r.status != RunStatus::Running {
                status = r.status;
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert_eq!(status, RunStatus::Completed);
    let (run, spans, _events) = state.load_trace(&id).unwrap();
    assert!(matches!(run.source, Source::Log));
    assert_eq!(run.agent_id, "nightly-research");
    assert!(spans.iter().any(|s| s.name == "gather"));
    assert!(spans.iter().any(|s| s.name == "save-results"));
}

#[tokio::test]
async fn failed_step_marks_run_failed() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new(bin(), project(), true, RunStore::new(dir.path()).unwrap());
    let id = state
        .launch_workflow("build-report".into(), "x".into())
        .await
        .unwrap();
    for _ in 0..200 {
        if let Some(r) = state.get_run(&id).await {
            if r.status != RunStatus::Running {
                assert_eq!(r.status, RunStatus::Failed);
                return;
            }
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("run never terminal");
}
