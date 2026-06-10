//! Offline package round-trip against a REAL `tau` binary. Skips unless
//! `TAU_REAL_BIN` points at a runnable tau. Builds a `file://` bare-git skill
//! package at runtime and isolates HOME so install never touches the dev's
//! real `~/.tau`.

use std::path::{Path, PathBuf};
use std::process::Command;
use tau_gateway::packages::{CliOps, PackageOps};

fn real_bin() -> Option<PathBuf> {
    std::env::var("TAU_REAL_BIN")
        .ok()
        .map(PathBuf::from)
        .filter(|p| p.exists())
}

fn git(args: &[&str], cwd: &Path) {
    let ok = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_AUTHOR_NAME", "t")
        .env("GIT_AUTHOR_EMAIL", "t@t")
        .env("GIT_COMMITTER_NAME", "t")
        .env("GIT_COMMITTER_EMAIL", "t@t")
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    assert!(ok, "git {:?} failed", args);
}

/// Author a skill package whose manifest `source` == the bare-repo url, commit,
/// tag, and bare-clone. Returns the `file://…demo-skill.git` url.
fn build_skill_package(root: &Path) -> String {
    let bare = root.join("demo-skill.git");
    let url = format!("file://{}", bare.display());
    let pkg = root.join("pkg");
    std::fs::create_dir_all(&pkg).unwrap();
    std::fs::write(
        pkg.join("tau.toml"),
        format!(
            "name = \"demo-skill\"\nversion = \"0.1.0\"\n\
             description = \"A tiny demo skill.\"\nauthors = []\n\
             source = \"{url}\"\nkind = \"skill\"\ndependencies = []\n\n\
             [[capabilities]]\nkind = \"fs.read\"\npaths = [\"${{SKILL_DIR}}/**\"]\n\n[skill]\n"
        ),
    )
    .unwrap();
    std::fs::write(
        pkg.join("SKILL.md"),
        "---\nname: demo-skill\ndescription: A tiny demo skill.\n---\n\n# Demo Skill\nHello.\n",
    )
    .unwrap();
    git(&["init", "-q"], &pkg);
    git(&["add", "-A"], &pkg);
    git(&["commit", "-qm", "v"], &pkg);
    git(&["tag", "v0.1.0"], &pkg);
    git(
        &[
            "clone",
            "-q",
            "--bare",
            pkg.to_str().unwrap(),
            bare.to_str().unwrap(),
        ],
        root,
    );
    url
}

#[test]
fn real_tau_package_round_trip_offline() {
    let Some(bin) = real_bin() else {
        eprintln!("skip: set TAU_REAL_BIN");
        return;
    };
    if Command::new("git").arg("--version").output().is_err() {
        eprintln!("skip: git not available");
        return;
    }

    let root = tempfile::tempdir().unwrap();
    // Isolate HOME so global-scope install writes under <tmp>/.tau, not ~/.tau.
    // SAFETY: single-threaded gated test; no other test reads HOME concurrently.
    std::env::set_var("HOME", root.path());

    let url = build_skill_package(root.path());

    let proj = root.path().join("proj");
    std::fs::create_dir_all(&proj).unwrap();
    std::fs::write(proj.join("tau.toml"), "[project]\nname = \"p\"\n").unwrap();

    let ops = CliOps::new(bin, proj.clone());

    // install
    let installed = ops.install(&url).expect("install");
    assert_eq!(installed.name, "demo-skill");
    assert_eq!(installed.version, "0.1.0");

    // list shows it
    assert!(
        ops.list().iter().any(|p| p.name == "demo-skill"),
        "list: {:?}",
        ops.list()
    );

    // verify reports ok
    let v = ops.verify();
    assert!(
        v.iter().any(|r| r.name == "demo-skill" && r.status == "ok"),
        "verify: {v:?}"
    );

    // uninstall removes it
    ops.uninstall("demo-skill").expect("uninstall");
    assert!(
        !ops.list().iter().any(|p| p.name == "demo-skill"),
        "still listed after uninstall"
    );
}
