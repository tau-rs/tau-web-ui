//! Append-only per-run JSONL persistence (handoff spec §3.4).
//! Layout: <data_dir>/<run_id>.jsonl  — first line is the Run header, then
//! interleaved Span/Event lines. On startup the dir is indexed to rebuild the
//! Runs list; a single file is replayed to reconstruct a full trace.

use std::collections::BTreeMap;
use std::path::PathBuf;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

use crate::trace::{Event, Run, Span};

/// One persisted line.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "record", rename_all = "snake_case")]
pub enum Record {
    RunHeader(Run),
    Span(Span),
    Event(Event),
}

#[derive(Clone)]
pub struct RunStore {
    dir: PathBuf,
}

impl RunStore {
    pub fn new(dir: impl Into<PathBuf>) -> Result<Self> {
        let dir = dir.into();
        std::fs::create_dir_all(&dir)?;
        Ok(RunStore { dir })
    }

    fn path(&self, run_id: &str) -> PathBuf { self.dir.join(format!("{run_id}.jsonl")) }

    async fn append(&self, run_id: &str, rec: &Record) -> Result<()> {
        let mut line = serde_json::to_string(rec)?;
        line.push('\n');
        let mut f = tokio::fs::OpenOptions::new()
            .create(true).append(true).open(self.path(run_id)).await?;
        f.write_all(line.as_bytes()).await?;
        f.flush().await?;
        Ok(())
    }

    pub async fn write_header(&self, run: &Run) -> Result<()> {
        self.append(&run.id, &Record::RunHeader(run.clone())).await
    }
    pub async fn write_span(&self, span: &Span) -> Result<()> {
        self.append(&span.run_id, &Record::Span(span.clone())).await
    }
    pub async fn write_event(&self, ev: &Event) -> Result<()> {
        self.append(&ev.run_id, &Record::Event(ev.clone())).await
    }
    /// Re-write the header (e.g. on finalize) by appending a newer RunHeader;
    /// the latest header wins on replay.
    pub async fn update_run(&self, run: &Run) -> Result<()> {
        self.append(&run.id, &Record::RunHeader(run.clone())).await
    }

    /// Replay one run: latest header + spans folded by id (latest wins) + events.
    pub fn load(&self, run_id: &str) -> Result<Option<(Run, Vec<Span>)>> {
        let path = self.path(run_id);
        if !path.exists() { return Ok(None); }
        let text = std::fs::read_to_string(path)?;
        let mut run: Option<Run> = None;
        let mut spans: BTreeMap<String, Span> = BTreeMap::new();
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            match serde_json::from_str::<Record>(line)? {
                Record::RunHeader(r) => run = Some(r),
                Record::Span(s) => { spans.insert(s.id.clone(), s); }
                Record::Event(_) => {}
            }
        }
        Ok(run.map(|r| (r, spans.into_values().collect())))
    }

    /// Index every run file into a Runs list (headers only), newest first.
    pub fn index(&self) -> Result<Vec<Run>> {
        let mut runs = vec![];
        for entry in std::fs::read_dir(&self.dir)? {
            let entry = entry?;
            if entry.path().extension().and_then(|e| e.to_str()) != Some("jsonl") { continue; }
            let id = entry.path().file_stem().unwrap().to_string_lossy().to_string();
            if let Some((run, _)) = self.load(&id)? { runs.push(run); }
        }
        runs.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        Ok(runs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trace::*;

    fn run(id: &str, status: RunStatus) -> Run {
        Run { id: id.into(), agent_id: "greeter".into(), prompt: "hi".into(),
            substrate: Substrate::Host, mode: Mode::Dev, status,
            started_at: "2026-05-31T00:00:00Z".into(), ended_at: None,
            total_turns: None, token_usage: None, stop_reason: None,
            error: None, source: Source::Serve }
    }

    #[tokio::test]
    async fn persists_and_replays() {
        let dir = tempfile::tempdir().unwrap();
        let store = RunStore::new(dir.path()).unwrap();
        store.write_header(&run("R1", RunStatus::Running)).await.unwrap();
        store.write_span(&Span { id: "s1".into(), parent_id: None, run_id: "R1".into(),
            kind: SpanKind::Turn, name: "turn 1".into(), status: SpanStatus::Running,
            started_at: "t".into(), ended_at: None, attributes: serde_json::json!({}) }).await.unwrap();
        store.write_span(&Span { id: "s1".into(), parent_id: None, run_id: "R1".into(),
            kind: SpanKind::Turn, name: "turn 1".into(), status: SpanStatus::Ok,
            started_at: "t".into(), ended_at: Some("t2".into()), attributes: serde_json::json!({}) }).await.unwrap();
        store.update_run(&run("R1", RunStatus::Completed)).await.unwrap();

        let (r, spans) = store.load("R1").unwrap().unwrap();
        assert_eq!(r.status, RunStatus::Completed);
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].status, SpanStatus::Ok);
    }

    #[tokio::test]
    async fn index_orders_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        let store = RunStore::new(dir.path()).unwrap();
        let mut a = run("A", RunStatus::Completed); a.started_at = "2026-05-31T00:00:01Z".into();
        let mut b = run("B", RunStatus::Completed); b.started_at = "2026-05-31T00:00:02Z".into();
        store.write_header(&a).await.unwrap();
        store.write_header(&b).await.unwrap();
        let idx = store.index().unwrap();
        assert_eq!(idx[0].id, "B");
        assert_eq!(idx[1].id, "A");
    }
}
