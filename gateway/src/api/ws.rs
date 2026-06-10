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

async fn send(socket: &mut WebSocket, m: &WsMessage) -> Result<(), axum::Error> {
    let txt = serde_json::to_string(m).unwrap();
    socket.send(Message::Text(txt.into())).await
}
