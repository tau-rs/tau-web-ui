//! Gated live tests: real `tau workflow run` end-to-end through the gateway.
//! Skipped unless `TAU_REAL_BIN` points at a runnable binary AND
//! `TAU_WORKFLOW_PROJECT` points at a tau project directory.
use std::path::PathBuf;
use std::time::Duration;
use tau_gateway::{state::AppState, store::RunStore, trace::RunStatus};

fn live() -> Option<(PathBuf, PathBuf)> {
    let bin = std::env::var("TAU_REAL_BIN")
        .ok()
        .map(PathBuf::from)
        .filter(|p| p.exists())?;
    let project = std::env::var("TAU_WORKFLOW_PROJECT")
        .ok()
        .map(PathBuf::from)
        .filter(|p| p.exists())?;
    Some((bin, project))
}

async fn wait_terminal(state: &AppState, id: &str) -> RunStatus {
    for _ in 0..400 {
        if let Some(r) = state.get_run(id).await {
            if r.status != RunStatus::Running {
                return r.status;
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("run never reached a terminal state");
}

#[tokio::test]
async fn live_workflow_runs_and_persists_steps() {
    let Some((bin, project)) = live() else {
        eprintln!("skip: set TAU_REAL_BIN + TAU_WORKFLOW_PROJECT");
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new(bin, project, true, RunStore::new(dir.path()).unwrap());
    let id = state
        .launch_workflow("echo".into(), "hello".into())
        .await
        .unwrap();
    let status = wait_terminal(&state, &id).await;
    assert_eq!(status, RunStatus::Completed);
    let Some((_run, spans, _events)) = state.load_trace(&id) else {
        panic!("trace not persisted for run {id}");
    };
    assert!(
        !spans.is_empty(),
        "live workflow must persist at least one step span"
    );
}

#[tokio::test]
async fn live_workflow_cancel_marks_cancelled() {
    let Some((bin, project)) = live() else {
        eprintln!("skip: set TAU_REAL_BIN + TAU_WORKFLOW_PROJECT");
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new(bin, project, true, RunStore::new(dir.path()).unwrap());
    let id = state
        .launch_workflow("echo".into(), "hello".into())
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    let cancelled = state.cancel(&id).await.unwrap();
    assert!(cancelled);
    let status = wait_terminal(&state, &id).await;
    assert_eq!(status, RunStatus::Cancelled);
}
