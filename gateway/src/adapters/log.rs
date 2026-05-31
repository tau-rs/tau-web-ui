//! log-adapter (DEFERRED SEAM): maps tau workflow-run JSONL (StepRecord) onto
//! the Trace model. Workflow runs live at `<scope>/.tau/workflow-runs/<name>-<id>.jsonl`.
//! Each line: {ts,run_id,step_id,step_index,kind,input,output,started_at,ended_at,
//! duration_ms,status("ok"|"failed"),error?,detail?}. Map each StepRecord to a
//! Span{kind: tool_call|agent}. Not built in v1 (workflows are not on the serve
//! path yet). Implement by tailing the file and reusing the same TraceDelta output.
