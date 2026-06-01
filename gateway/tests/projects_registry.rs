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

#[tokio::test]
async fn add_git_clones_via_mock_then_remove() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    // bin() is fake-tau-serve -> MockCloner seeds a tau.toml, no network.
    let meta = reg
        .add_git("https://github.com/acme/cool-bot.git")
        .await
        .unwrap();
    assert_eq!(meta.id, "cool-bot");
    match meta.source {
        ProjectSource::Git { ref url } => assert!(url.contains("cool-bot")),
        _ => panic!("expected Git source"),
    }
    assert!(reg.state("cool-bot").await.is_some());

    assert!(reg.remove("cool-bot").await.unwrap());
    assert!(reg.state("cool-bot").await.is_none());
    assert!(!reg.remove("cool-bot").await.unwrap()); // already gone
}

#[tokio::test]
async fn summaries_reflect_runs() {
    use tau_gateway::trace::RunStatus;
    let data = tempfile::tempdir().unwrap();
    let proj = make_project("demo");
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    reg.add_local(proj.path()).await.unwrap();
    let state = reg.state("demo").await.unwrap();

    let id = state.launch("greeter".into(), "hi".into()).await.unwrap();
    for _ in 0..200 {
        if let Some(r) = state.get_run(&id).await {
            if r.status != RunStatus::Running {
                break;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }

    let items = reg.list_summaries("2999-01-01T00:00:00Z").await;
    let demo = items.iter().find(|i| i.meta.id == "demo").unwrap();
    assert_eq!(demo.summary.runs, 1);
    assert!(demo.summary.agents >= 1);
    assert!(demo.summary.success_rate > 0.0);
}

#[tokio::test]
async fn cross_runs_aggregates_and_filters() {
    let data = tempfile::tempdir().unwrap();
    let a = make_project("alpha");
    let b = make_project("beta");
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    reg.add_local(a.path()).await.unwrap();
    reg.add_local(b.path()).await.unwrap();
    reg.state("alpha")
        .await
        .unwrap()
        .launch("greeter".into(), "hi".into())
        .await
        .unwrap();
    reg.state("beta")
        .await
        .unwrap()
        .launch("greeter".into(), "hi".into())
        .await
        .unwrap();

    let all = reg.cross_runs(None, 50).await;
    assert_eq!(all.len(), 2);
    let ids: Vec<&str> = all.iter().map(|r| r.project_id.as_str()).collect();
    assert!(ids.contains(&"alpha") && ids.contains(&"beta"));

    assert_eq!(reg.cross_runs(None, 1).await.len(), 1);
}
