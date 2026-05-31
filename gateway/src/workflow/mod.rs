//! Workflow runner: produces a stream of StepRecords for a workflow run.
//! `MockRunner` fabricates canned step sequences (used with fake-tau-serve);
//! `CliRunner` is the seam for real `tau workflow run` + JSONL tail.

use std::path::PathBuf;
use std::time::Duration;

use tokio::sync::mpsc;

use crate::adapters::log::StepRecord;

#[derive(Debug, Clone)]
pub enum WorkflowItem {
    Step(Box<StepRecord>),
    Done,
    Error(String),
}

pub trait WorkflowRunner: Send + Sync {
    /// Start the workflow; returns a receiver of items (the impl spawns its own task).
    fn run(
        &self,
        workflow: String,
        input: String,
        run_id: String,
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
    ) -> mpsc::UnboundedReceiver<WorkflowItem> {
        let (tx, rx) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            for (i, (step_id, kind, output, status, delay)) in
                script(&workflow).into_iter().enumerate()
            {
                tokio::time::sleep(Duration::from_millis(delay)).await;
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

/// Seam: run real `tau workflow run` and tail the JSONL log. Not wired in v1
/// (the mock path covers fake-tau-serve). When real tau is the target, implement:
/// spawn `tau workflow run <workflow> --input <input>`, read `run_id:` from stderr,
/// tail `<project>/.tau/workflow-runs/<workflow>-<id>.jsonl` emitting `Step` per new
/// line, then `Done` on process exit.
pub struct CliRunner {
    #[allow(dead_code)]
    bin: PathBuf,
    #[allow(dead_code)]
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
        _input: String,
        _run_id: String,
    ) -> mpsc::UnboundedReceiver<WorkflowItem> {
        let (tx, rx) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            let _ = tx.send(WorkflowItem::Error(format!(
                "real-tau workflow run not wired yet (run `{workflow}` via the tau CLI); \
                 the gateway observes workflows only with fake-tau-serve in v1"
            )));
        });
        rx
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mock_runner_emits_steps_then_done() {
        let mut rx = MockRunner.run("nightly-research".into(), "topic".into(), "R1".into());
        let mut kinds = vec![];
        let mut done = false;
        while let Some(item) = rx.recv().await {
            match item {
                WorkflowItem::Step(s) => kinds.push(s.kind),
                WorkflowItem::Done => {
                    done = true;
                    break;
                }
                WorkflowItem::Error(e) => panic!("unexpected error {e}"),
            }
        }
        assert!(done);
        assert_eq!(kinds, vec!["agent.run", "agent.run", "tool.call"]);
    }

    #[tokio::test]
    async fn build_report_has_a_failed_step() {
        let mut rx = MockRunner.run("build-report".into(), "x".into(), "R2".into());
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
