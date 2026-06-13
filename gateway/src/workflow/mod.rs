//! Workflow runner: produces a stream of StepRecords for a workflow run.
//! `MockRunner` fabricates canned step sequences (used with fake-tau-serve);
//! `CliRunner` is the seam for real `tau workflow run` + JSONL tail.

use std::collections::HashSet;
use std::ffi::OsString;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, Mutex};
use tokio_util::sync::CancellationToken;

use crate::adapters::log::StepRecord;

#[derive(Debug, Clone)]
pub enum WorkflowItem {
    Step(Box<StepRecord>),
    Done,
    Cancelled,
    Error(String),
}

pub trait WorkflowRunner: Send + Sync {
    /// Start the workflow; returns a receiver of items (the impl spawns its own
    /// task). Firing `cancel` requests termination (the impl emits `Cancelled`).
    fn run(
        &self,
        workflow: String,
        input: String,
        run_id: String,
        cancel: CancellationToken,
    ) -> mpsc::UnboundedReceiver<WorkflowItem>;
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// (step_id, kind, output, status, delay_before_ms)
type Scripted = (&'static str, &'static str, &'static str, &'static str, u64);

fn script(workflow: &str) -> Vec<Scripted> {
    match workflow {
        "build-report" => vec![
            ("collect", "agent.run", "collected 12 rows", "ok", 60),
            ("render", "tool.call", "", "failed", 50),
        ],
        _ => vec![
            ("gather", "agent.run", "found 4 drivers", "ok", 50),
            (
                "summarise",
                "agent.run",
                "summary: pricing & onboarding",
                "ok",
                70,
            ),
            (
                "save-results",
                "tool.call",
                "wrote /tmp/nightly.md",
                "ok",
                30,
            ),
        ],
    }
}

pub struct MockRunner;

impl WorkflowRunner for MockRunner {
    fn run(
        &self,
        workflow: String,
        input: String,
        run_id: String,
        cancel: CancellationToken,
    ) -> mpsc::UnboundedReceiver<WorkflowItem> {
        let (tx, rx) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            for (i, (step_id, kind, output, status, delay)) in
                script(&workflow).into_iter().enumerate()
            {
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_millis(delay)) => {}
                    _ = cancel.cancelled() => {
                        let _ = tx.send(WorkflowItem::Cancelled);
                        return;
                    }
                }
                let started = now();
                let ended = now();
                let rec = StepRecord {
                    ts: now(),
                    run_id: run_id.clone(),
                    step_id: step_id.to_string(),
                    step_index: i as u32,
                    kind: kind.to_string(),
                    input: if i == 0 { input.clone() } else { String::new() },
                    output: output.to_string(),
                    started_at: started,
                    ended_at: ended,
                    duration_ms: delay,
                    status: status.to_string(),
                    error: (status == "failed").then(|| "tool_error".to_string()),
                    detail: (status == "failed").then(|| "mock render failure".to_string()),
                };
                if tx.send(WorkflowItem::Step(Box::new(rec))).is_err() {
                    return;
                }
            }
            let _ = tx.send(WorkflowItem::Done);
        });
        rx
    }
}

/// Tails tau's append-only workflow-run JSONL. Detects the new
/// `<name>-*.jsonl` file (the one absent from the pre-spawn snapshot),
/// then yields one `StepRecord` per newly-completed line. Partial trailing
/// lines (no newline yet) are buffered until completed.
struct TailReader {
    dir: PathBuf,
    prefix: String,
    snapshot: HashSet<OsString>,
    path: Option<PathBuf>,
    offset: u64,
    leftover: String,
    saw_failed: bool,
}

impl TailReader {
    fn new(dir: PathBuf, name: &str, snapshot: HashSet<OsString>) -> Self {
        TailReader {
            dir,
            prefix: format!("{name}-"),
            snapshot,
            path: None,
            offset: 0,
            leftover: String::new(),
            saw_failed: false,
        }
    }

    fn detect(&self) -> Option<PathBuf> {
        let entries = std::fs::read_dir(&self.dir).ok()?;
        let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
        for e in entries.flatten() {
            let name = e.file_name();
            let Some(s) = name.to_str() else { continue };
            if !(s.starts_with(&self.prefix) && s.ends_with(".jsonl")) {
                continue;
            }
            if self.snapshot.contains(&name) {
                continue;
            }
            let mtime = e
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            if best.as_ref().map(|(t, _)| mtime >= *t).unwrap_or(true) {
                best = Some((mtime, e.path()));
            }
        }
        best.map(|(_, p)| p)
    }

    fn poll(&mut self) -> Vec<StepRecord> {
        if self.path.is_none() {
            self.path = self.detect();
        }
        let Some(path) = self.path.clone() else {
            return vec![];
        };
        let mut out = vec![];
        let Ok(mut f) = std::fs::File::open(&path) else {
            return out;
        };
        if f.seek(SeekFrom::Start(self.offset)).is_err() {
            return out;
        }
        let mut buf = String::new();
        let Ok(n) = f.read_to_string(&mut buf) else {
            return out;
        };
        self.offset += n as u64;
        let mut data = std::mem::take(&mut self.leftover);
        data.push_str(&buf);
        let ends_nl = data.ends_with('\n');
        let mut parts: Vec<&str> = data.split('\n').collect();
        if ends_nl {
            parts.pop();
        } else {
            self.leftover = parts.pop().unwrap_or("").to_string();
        }
        for line in parts {
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<StepRecord>(line) {
                Ok(rec) => {
                    if rec.status == "failed" {
                        self.saw_failed = true;
                    }
                    out.push(rec);
                }
                Err(e) => tracing::warn!("unparseable workflow step line: {e}: {line}"),
            }
        }
        out
    }
}

/// Seam: run real `tau workflow run` and tail the JSONL log.
pub struct CliRunner {
    bin: PathBuf,
    project: PathBuf,
}

impl CliRunner {
    pub fn new(bin: PathBuf, project: PathBuf) -> Self {
        CliRunner { bin, project }
    }
}

impl WorkflowRunner for CliRunner {
    fn run(
        &self,
        workflow: String,
        input: String,
        _run_id: String,
        cancel: CancellationToken,
    ) -> mpsc::UnboundedReceiver<WorkflowItem> {
        let (tx, rx) = mpsc::unbounded_channel();
        let bin = self.bin.clone();
        let project = self.project.clone();
        tokio::spawn(async move {
            let runs_dir = project.join(".tau").join("workflow-runs");

            let prefix = format!("{workflow}-");
            let snapshot: HashSet<OsString> = std::fs::read_dir(&runs_dir)
                .into_iter()
                .flatten()
                .flatten()
                .map(|e| e.file_name())
                .filter(|n| {
                    n.to_str()
                        .map(|s| s.starts_with(&prefix) && s.ends_with(".jsonl"))
                        .unwrap_or(false)
                })
                .collect();

            let mut cmd = Command::new(&bin);
            cmd.arg("workflow")
                .arg("run")
                .arg(&workflow)
                .arg("--input")
                .arg(&input)
                .current_dir(&project)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .kill_on_drop(true);

            let mut child = match cmd.spawn() {
                Ok(c) => c,
                Err(e) => {
                    let _ = tx.send(WorkflowItem::Error(format!(
                        "spawn `tau workflow run {workflow}`: {e}"
                    )));
                    return;
                }
            };

            let err_buf = Arc::new(Mutex::new(String::new()));
            if let Some(se) = child.stderr.take() {
                let eb = err_buf.clone();
                tokio::spawn(async move {
                    let mut lines = BufReader::new(se).lines();
                    while let Ok(Some(l)) = lines.next_line().await {
                        let mut g = eb.lock().await;
                        g.push_str(&l);
                        g.push('\n');
                    }
                });
            }

            let mut reader = TailReader::new(runs_dir, &workflow, snapshot);
            let mut tick = tokio::time::interval(Duration::from_millis(50));
            let mut cancelled = false;

            loop {
                tokio::select! {
                    _ = tick.tick() => {}
                    _ = cancel.cancelled(), if !cancelled => {
                        cancelled = true;
                        let _ = child.start_kill();
                    }
                }

                for rec in reader.poll() {
                    if tx.send(WorkflowItem::Step(Box::new(rec))).is_err() {
                        let _ = child.start_kill();
                        return;
                    }
                }

                match child.try_wait() {
                    Ok(Some(status)) => {
                        for rec in reader.poll() {
                            let _ = tx.send(WorkflowItem::Step(Box::new(rec)));
                        }
                        if cancelled {
                            let _ = tx.send(WorkflowItem::Cancelled);
                        } else if status.success() || reader.saw_failed {
                            let _ = tx.send(WorkflowItem::Done);
                        } else {
                            let msg = err_buf.lock().await.trim().to_string();
                            let msg = if msg.is_empty() {
                                format!("tau workflow run exited: {status}")
                            } else {
                                msg
                            };
                            let _ = tx.send(WorkflowItem::Error(msg));
                        }
                        return;
                    }
                    Ok(None) => {}
                    Err(e) => {
                        let _ = tx.send(WorkflowItem::Error(format!(
                            "waiting on tau workflow child: {e}"
                        )));
                        return;
                    }
                }
            }
        });
        rx
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_reader_emits_complete_lines_and_tracks_failure() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let runs = dir.path().to_path_buf();
        let path = runs.join("wf-01HK.jsonl");
        std::fs::write(&path, "").unwrap();

        let mut reader = TailReader::new(runs.clone(), "wf", std::collections::HashSet::new());

        {
            let mut f = std::fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap();
            f.write_all(br#"{"ts":"t","run_id":"r","step_id":"a","step_index":0,"kind":"agent.run","input":"i","output":"o","started_at":"s","ended_at":"e","duration_ms":1,"status":"ok"}"#).unwrap();
        }
        assert!(reader.poll().is_empty(), "partial line must not parse yet");

        {
            let mut f = std::fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap();
            writeln!(f).unwrap();
            f.write_all(b"{\"ts\":\"t\",\"run_id\":\"r\",\"step_id\":\"b\",\"step_index\":1,\"kind\":\"tool.call\",\"input\":\"i\",\"output\":\"\",\"started_at\":\"s\",\"ended_at\":\"e\",\"duration_ms\":1,\"status\":\"failed\",\"error\":\"tool_error\",\"detail\":\"boom\"}\n").unwrap();
        }
        let recs = reader.poll();
        assert_eq!(recs.len(), 2);
        assert_eq!(recs[0].step_id, "a");
        assert_eq!(recs[1].status, "failed");
        assert!(reader.saw_failed);
    }

    #[tokio::test]
    async fn mock_runner_emits_steps_then_done() {
        let mut rx = MockRunner.run(
            "nightly-research".into(),
            "topic".into(),
            "R1".into(),
            tokio_util::sync::CancellationToken::new(),
        );
        let mut kinds = vec![];
        let mut done = false;
        while let Some(item) = rx.recv().await {
            match item {
                WorkflowItem::Step(s) => kinds.push(s.kind),
                WorkflowItem::Done => {
                    done = true;
                    break;
                }
                WorkflowItem::Cancelled => panic!("unexpected cancel"),
                WorkflowItem::Error(e) => panic!("unexpected error {e}"),
            }
        }
        assert!(done);
        assert_eq!(kinds, vec!["agent.run", "agent.run", "tool.call"]);
    }

    #[tokio::test]
    async fn build_report_has_a_failed_step() {
        let mut rx = MockRunner.run(
            "build-report".into(),
            "x".into(),
            "R2".into(),
            tokio_util::sync::CancellationToken::new(),
        );
        let mut statuses = vec![];
        while let Some(item) = rx.recv().await {
            match item {
                WorkflowItem::Step(s) => statuses.push(s.status),
                _ => break,
            }
        }
        assert!(statuses.contains(&"failed".to_string()));
    }
}
