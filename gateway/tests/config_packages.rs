use std::path::PathBuf;
use tau_gateway::{state::AppState, store::RunStore};

fn bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}

fn temp_project() -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    std::fs::write(
        d.path().join("tau.toml"),
        "[project]\nname = \"demo\"\n\n[agents.greeter]\ndisplay_name = \"Greeter\"\npackage = \"greeter@^0.1\"\nllm_backend = \"anthropic\"\n",
    )
    .unwrap();
    d
}

#[tokio::test]
async fn config_read_write_roundtrip() {
    let proj = temp_project();
    let store = RunStore::new(tempfile::tempdir().unwrap().path()).unwrap();
    let state = AppState::new(bin(), proj.path().to_path_buf(), true, store);
    assert_eq!(state.config_read().unwrap().name, "demo");
    state.config_write("renamed", Some("d")).unwrap();
    assert_eq!(state.config_read().unwrap().name, "renamed");
}

#[tokio::test]
async fn packages_mock_crud() {
    let proj = temp_project();
    let store = RunStore::new(tempfile::tempdir().unwrap().path()).unwrap();
    let state = AppState::new(bin(), proj.path().to_path_buf(), true, store);
    assert_eq!(state.packages().len(), 3);
    state
        .package_install("https://github.com/acme/x.git")
        .unwrap();
    assert_eq!(state.packages().len(), 4);
}

#[tokio::test]
async fn import_agent_installs_and_registers() {
    let proj = temp_project();
    let store = RunStore::new(tempfile::tempdir().unwrap().path()).unwrap();
    let state = AppState::new(bin(), proj.path().to_path_buf(), true, store);
    let id = state
        .import_agent("https://github.com/acme/researcher-pro.git", "anthropic")
        .unwrap();
    assert_eq!(id, "researcher-pro");
    let cfg = state.config_read().unwrap();
    assert!(cfg.agents.iter().any(|a| a.id == "researcher-pro"));
}
