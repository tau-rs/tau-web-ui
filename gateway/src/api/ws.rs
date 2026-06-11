//! WS /api/projects/:pid/runs/:id/events — replay snapshot, then stream live
//! WsMessages; close when the run reaches a terminal status.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::Path;
use axum::response::IntoResponse;
use futures::{SinkExt, StreamExt};

use crate::api::scope::Scoped;
use crate::state::AppState;
use crate::trace::{RunStatus, WsMessage};

pub async fn ws_handler(
    Scoped(state): Scoped,
    Path((_pid, run_id)): Path<(String, String)>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle(socket, state, run_id))
}

async fn handle(mut socket: WebSocket, state: AppState, run_id: String) {
    let mut rx = state.subscribe(&run_id).await;

    if let Some((run, spans, events)) = state.load_trace(&run_id) {
        let terminal = run.status != RunStatus::Running;
        let snap = WsMessage::Snapshot { run, spans, events };
        if send(&mut socket, &snap).await.is_err() {
            return;
        }
        if terminal {
            let _ = socket.close().await;
            return;
        }
    }

    loop {
        tokio::select! {
            msg = rx.recv() => match msg {
                Ok(m) => {
                    let terminal = matches!(&m,
                        WsMessage::RunUpdate { run } if run.status != RunStatus::Running);
                    if send(&mut socket, &m).await.is_err() { break; }
                    if terminal { let _ = socket.close().await; break; }
                }
                Err(_) => break,
            },
            client = socket.next() => match client {
                Some(Ok(Message::Close(_))) | None => break,
                _ => {}
            }
        }
    }
}

/// A frame prepared for the wire, or a signal to drop it. Split from the socket
/// I/O in `send` so the serialization-failure path is unit-testable without a
/// live socket (a `WsMessage` itself never holds the float/non-string-key shapes
/// that make `serde_json` fail, so the failure can only be exercised generically).
enum Outgoing {
    Frame(Message),
    /// Serialization failed; the caller should close the socket cleanly.
    Drop,
}

fn prepare<T: serde::Serialize>(m: &T) -> Outgoing {
    match serde_json::to_string(m) {
        Ok(txt) => Outgoing::Frame(Message::Text(txt.into())),
        Err(e) => {
            tracing::warn!("dropping WS frame: serialization failed: {e}");
            Outgoing::Drop
        }
    }
}

async fn send(socket: &mut WebSocket, m: &WsMessage) -> Result<(), axum::Error> {
    match prepare(m) {
        Outgoing::Frame(frame) => socket.send(frame).await,
        // Serialization failed (logged in `prepare`): close cleanly so the client
        // gets a Close frame, and signal Err so the caller stops streaming —
        // instead of `unwrap()` panicking the task that owns this socket.
        Outgoing::Drop => {
            let _ = socket.close().await;
            Err(axum::Error::new("ws frame serialization failed"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trace::Event;

    fn event_frame() -> WsMessage {
        WsMessage::Event {
            event: Event {
                run_id: "R1".into(),
                span_id: None,
                ts: "t".into(),
                kind: "text_delta".into(),
                payload: serde_json::json!({ "text": "hi" }),
            },
        }
    }

    #[test]
    fn prepare_wraps_a_serializable_frame_as_a_text_message() {
        match prepare(&event_frame()) {
            Outgoing::Frame(Message::Text(txt)) => {
                assert!(txt.contains("\"type\":\"event\""));
                assert!(txt.contains("\"text\":\"hi\""));
            }
            _ => panic!("expected a text frame"),
        }
    }

    #[test]
    fn prepare_drops_an_unserializable_value_instead_of_panicking() {
        // A map with a non-string (tuple) key cannot be a JSON object, so
        // `serde_json::to_string` errors. The previous `to_string(..).unwrap()`
        // would have panicked the socket task; `prepare` must map it to a clean
        // Drop so the send path can close the socket gracefully.
        let mut bad = std::collections::BTreeMap::new();
        bad.insert((1u8, 2u8), 3u8);
        assert!(
            serde_json::to_string(&bad).is_err(),
            "fixture must be unserializable"
        );
        assert!(matches!(prepare(&bad), Outgoing::Drop));
    }
}
