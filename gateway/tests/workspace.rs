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
async fn workspace_is_not_persisted_to_manifest() {
    let data = tempfile::tempdir().unwrap();
    let proj = make_project("demo");
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    reg.add_local(proj.path()).await.unwrap(); // triggers write_manifest
    let manifest = std::fs::read_to_string(data.path().join("projects.json")).unwrap();
    assert!(!manifest.contains("workspace"), "manifest leaked workspace: {manifest}");
    assert!(manifest.contains("demo"));
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

#[tokio::test]
async fn workspace_cannot_be_removed() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    assert!(reg.remove(WORKSPACE_ID).await.is_err());
    assert!(reg.state(WORKSPACE_ID).await.is_some()); // still registered
}

#[tokio::test]
async fn save_workspace_as_copies_registers_and_resets() {
    use tau_gateway::config::{AgentDetail, AgentPrompt};
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();

    // author an agent in the workspace
    let ws = reg.state(WORKSPACE_ID).await.unwrap();
    ws.write_agent(&AgentDetail {
        id: "scratchy".into(),
        display_name: Some("Scratchy".into()),
        package: None,
        llm_backend: Some("anthropic".into()),
        prompt: AgentPrompt::default(),
        requires_tools: vec![],
    })
    .unwrap();

    // save-as into a fresh target dir
    let target = data.path().join("saved-proj");
    let meta = reg.save_workspace_as(&target).await.unwrap();

    // the new project is registered and carries the agent
    assert!(reg.state(&meta.id).await.is_some());
    let saved = reg.state(&meta.id).await.unwrap();
    assert!(saved.read_agent("scratchy").unwrap().is_some());

    // the workspace was reset (agent gone)
    let ws2 = reg.state(WORKSPACE_ID).await.unwrap();
    assert!(ws2.read_agent("scratchy").unwrap().is_none());

    // saving onto an occupied dir fails
    assert!(reg.save_workspace_as(&target).await.is_err());
}
