use std::path::PathBuf;
use tau_gateway::projects::ProjectRegistry;

fn real_bin_name() -> PathBuf {
    // A non-"fake-tau-serve" name autodetects is_mock=false.
    PathBuf::from("/usr/local/bin/tau")
}

#[tokio::test]
async fn serve_kind_mock_override_forces_mock_sidecars_even_with_real_bin_name() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load_with_kind(
        real_bin_name(),
        true,
        data.path().to_path_buf(),
        Some(true), // is_mock override = mock
    )
    .await
    .unwrap();
    let state = reg
        .state(tau_gateway::projects::WORKSPACE_ID)
        .await
        .unwrap();
    assert!(
        !state.list_tools().tools.is_empty(),
        "mock sidecar seam should yield deterministic tools"
    );
}

#[tokio::test]
async fn load_defaults_to_filename_autodetect() {
    let data = tempfile::tempdir().unwrap();
    let reg =
        ProjectRegistry::load_with_kind(real_bin_name(), true, data.path().to_path_buf(), None)
            .await
            .unwrap();
    let state = reg
        .state(tau_gateway::projects::WORKSPACE_ID)
        .await
        .unwrap();
    assert!(state.list_tools().tools.is_empty());
}
