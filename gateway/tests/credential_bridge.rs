use std::path::PathBuf;
use tau_gateway::credentials::{Credentials, SourceConfig, SourceKind};
use tau_gateway::projects::ProjectRegistry;

fn mock_bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}

#[tokio::test]
async fn local_credential_reaches_the_serve_child() {
    let data = tempfile::tempdir().unwrap();
    // Store a Local secret for anthropic in this gateway's data_root.
    Credentials::new(data.path().to_path_buf())
        .put(
            "anthropic",
            vec![SourceConfig {
                kind: SourceKind::Local,
                reference: None,
            }],
            Some("sk-bridge".into()),
        )
        .unwrap();

    let reg =
        ProjectRegistry::load_with_kind(mock_bin(), true, data.path().to_path_buf(), Some(true))
            .await
            .unwrap();
    let state = reg
        .state(tau_gateway::projects::WORKSPACE_ID)
        .await
        .unwrap();

    // Spawning the child injects ANTHROPIC_API_KEY; the mock confirms presence.
    let client = state.client().await.unwrap();
    assert!(client.debug_env_present("ANTHROPIC_API_KEY").await.unwrap());
}
