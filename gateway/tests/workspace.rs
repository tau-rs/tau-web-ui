use std::path::PathBuf;
use tau_gateway::projects::{ProjectRegistry, ProjectSource, WORKSPACE_ID};

fn bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}

fn make_project(name: &str) -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    std::fs::write(
        d.path().join("tau.toml"),
        format!("[project]\nname = \"{name}\"\n"),
    )
    .unwrap();
    d
}

#[tokio::test]
async fn workspace_is_auto_provisioned() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let metas = reg.metas().await;
    let ws = metas.iter().find(|m| m.id == WORKSPACE_ID).unwrap();
    assert_eq!(ws.source, ProjectSource::Workspace);
    assert!(reg.state(WORKSPACE_ID).await.is_some());
    assert!(data.path().join("workspace/tau.toml").exists());
}

#[tokio::test]
async fn user_project_named_workspace_dedupes() {
    let data = tempfile::tempdir().unwrap();
    let proj = make_project("workspace");
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let meta = reg.add_local(proj.path()).await.unwrap();
    assert_eq!(meta.id, "workspace-2");
}
