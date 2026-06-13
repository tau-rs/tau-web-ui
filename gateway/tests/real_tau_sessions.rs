//! Gated on TAU_REAL_BIN. Writes a known `.tau/sessions/<id>.jsonl` into a temp
//! project, then asserts the real `tau session list/export` read it back through
//! the gateway's CliSessions seam. Skipped when TAU_REAL_BIN is unset/missing.

use std::fs;
use std::path::PathBuf;

use tau_gateway::sessions::{CliSessions, ExportFormat, SessionsSource};

fn real_bin() -> Option<PathBuf> {
    std::env::var("TAU_REAL_BIN")
        .ok()
        .map(PathBuf::from)
        .filter(|p| p.exists())
}

const SESSION_ID: &str = "018f5a2c-1111-2222-3333-444455556666";

fn seed(project: &std::path::Path) {
    let dir = project.join(".tau/sessions");
    fs::create_dir_all(&dir).unwrap();
    let header = serde_json::json!({
        "type": "header", "schema": 1, "id": SESSION_ID,
        "created_at": "2026-06-12T14:33:21Z", "agent_id": "coder",
        "package": { "name": "demo", "version": "0.1.0", "resolved_commit": "0".repeat(40) },
        "llm_backend": "anthropic", "title": null
    });
    let msg = serde_json::json!({ "type": "message", "msg": { "from": "user", "payload": { "text": "hi" } } });
    let turn = serde_json::json!({ "type": "turn_summary", "turn": 1, "stop_reason": "EndTurn", "input_tokens": 10, "output_tokens": 5 });
    let body = format!("{header}\n{msg}\n{turn}\n");
    fs::write(dir.join(format!("{SESSION_ID}.jsonl")), body).unwrap();
}

#[test]
fn real_tau_reads_seeded_session() {
    let Some(bin) = real_bin() else {
        eprintln!("skipping: TAU_REAL_BIN unset or missing");
        return;
    };
    let tmp = tempfile::tempdir().unwrap();
    fs::write(tmp.path().join("tau.toml"), "[project]\nname = \"demo\"\n").unwrap();
    seed(tmp.path());

    let cli = CliSessions::new(bin, tmp.path().to_path_buf());

    let rows = cli.list().expect("list");
    assert!(
        rows.iter().any(|r| r.id == SESSION_ID),
        "seeded session not listed: {rows:?}"
    );

    let detail = cli.show(SESSION_ID).expect("show");
    assert_eq!(detail.header.agent_id, "coder");
    assert_eq!(detail.turn_summaries.len(), 1);

    let md = cli.export(SESSION_ID, ExportFormat::Md).expect("export md");
    assert!(!md.is_empty());
}
