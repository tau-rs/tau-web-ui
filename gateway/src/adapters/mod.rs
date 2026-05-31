//! Ingest adapters normalize any event source into the Trace model (§1.2).
//! v1 ships `serve`. `log` and `otlp` are designed seams (stubs).
pub mod log;
pub mod otlp;
pub mod serve;

use crate::trace::{Event, Run, Span};

/// Incremental output of an adapter as it consumes a source.
#[derive(Debug, Clone)]
pub enum TraceDelta {
    SpanOpened(Span),
    SpanUpdated(Span),
    Event(Event),
    RunUpdated(Run),
}
