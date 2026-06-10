//! Live checks against a REAL `tau` binary. Skips unless `TAU_REAL_BIN` points at
//! a runnable binary. `tau target list` needs no project; `tau check` runs on the
//! bare demo fixture (which a real tau reports config findings for — exit 2).

use std::path::PathBuf;
use std::process::Command;

fn real_bin() -> Option<PathBuf> {
    std::env::var("TAU_REAL_BIN")
        .ok()
        .map(PathBuf::from)
        .filter(|p| p.exists())
}

fn demo() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("fixtures/demo");
    p
}

#[test]
fn real_tau_target_list_emits_triples() {
    let Some(bin) = real_bin() else {
        eprintln!("skip: set TAU_REAL_BIN");
        return;
    };
    let out = Command::new(bin)
        .arg("target")
        .arg("list")
        .arg("--all")
        .arg("--json")
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("\"event\":\"target\""), "got: {stdout}");
    assert!(
        stdout.contains("darwin-native-strict") || stdout.contains("linux-native-strict"),
        "got: {stdout}"
    );
}

#[test]
fn real_tau_check_runs_and_reports_categories() {
    let Some(bin) = real_bin() else {
        eprintln!("skip: set TAU_REAL_BIN");
        return;
    };
    let out = Command::new(bin)
        .arg("check")
        .arg("--json")
        .arg("--project")
        .arg(demo())
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    // Non-zero exit is expected (the bare fixture has findings); assert the JSONL shape.
    assert!(stdout.contains("\"type\":\"run_started\""), "got: {stdout}");
    assert!(stdout.contains("\"category\":\"config\""), "got: {stdout}");
}
