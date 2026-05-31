//! otlp-adapter (DEFERRED SEAM): maps OTLP spans -> Trace Spans for prod /
//! any-substrate monitoring. The Trace model is already OTLP-shaped (parent_id,
//! started_at/ended_at, attributes), so this is a thin field map. Gated on tau
//! artifacts emitting OTLP. Not built in v1.
