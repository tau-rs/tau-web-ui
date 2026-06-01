use std::path::PathBuf;
use tau_gateway::projects::{ProjectRegistry, ProjectSource};

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
        format!("[project]\nname = \"{name}\"\n\n[agents.greeter]\ndisplay_name = \"Greeter\"\nllm_backend = \"anthropic\"\n"),
    )
    .unwrap();
    d
}

#[tokio::test]
async fn add_local_registers_and_persists() {
    let data = tempfile::tempdir().unwrap();
    let proj = make_project("demo");
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let meta = reg.add_local(proj.path()).await.unwrap();
    assert_eq!(meta.id, "demo");
    assert_eq!(meta.source, ProjectSource::Local);
    assert!(reg.state("demo").await.is_some());

    let reg2 = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    assert!(reg2.state("demo").await.is_some());
}

#[tokio::test]
async fn add_local_dedupes_id_on_name_collision() {
    let data = tempfile::tempdir().unwrap();
    let a = make_project("demo");
    let b = make_project("demo");
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let ma = reg.add_local(a.path()).await.unwrap();
    let mb = reg.add_local(b.path()).await.unwrap();
    assert_eq!(ma.id, "demo");
    assert_eq!(mb.id, "demo-2");
}

#[tokio::test]
async fn add_local_rejects_dir_without_tau_toml() {
    let data = tempfile::tempdir().unwrap();
    let empty = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    assert!(reg.add_local(empty.path()).await.is_err());
}
