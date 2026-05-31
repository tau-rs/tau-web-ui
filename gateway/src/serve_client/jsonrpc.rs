//! NDJSON JSON-RPC 2.0 envelopes for the tau serve protocol.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum RequestId {
    Int(i64),
    Str(String),
}

#[derive(Debug, Clone, Serialize)]
pub struct Request {
    pub jsonrpc: &'static str,
    pub id: RequestId,
    pub method: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl Request {
    pub fn new(id: i64, method: &'static str, params: Value) -> Self {
        Request {
            jsonrpc: "2.0",
            id: RequestId::Int(id),
            method,
            params: Some(params),
        }
    }
}

/// Anything the child writes to stdout: a result, an error, or a notification.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum Inbound {
    Notification { method: String, params: Value },
    Result { id: RequestId, result: Value },
    Error { id: RequestId, error: RpcError },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_notification() {
        let line = r#"{"jsonrpc":"2.0","method":"runtime.event","params":{"id":4,"kind":"TextDelta","data":{"text":"hi"}}}"#;
        match serde_json::from_str::<Inbound>(line).unwrap() {
            Inbound::Notification { method, params } => {
                assert_eq!(method, "runtime.event");
                assert_eq!(params["id"], 4);
                assert_eq!(params["kind"], "TextDelta");
            }
            other => panic!("expected notification, got {other:?}"),
        }
    }

    #[test]
    fn parses_result_and_error() {
        let ok = r#"{"jsonrpc":"2.0","id":4,"result":{"final":true,"stop_reason":"end_turn"}}"#;
        assert!(matches!(
            serde_json::from_str::<Inbound>(ok).unwrap(),
            Inbound::Result { .. }
        ));
        let err =
            r#"{"jsonrpc":"2.0","id":4,"error":{"code":-32001,"message":"Cancelled by client"}}"#;
        match serde_json::from_str::<Inbound>(err).unwrap() {
            Inbound::Error { error, .. } => assert_eq!(error.code, -32001),
            other => panic!("expected error, got {other:?}"),
        }
    }

    #[test]
    fn serializes_request() {
        let r = Request::new(1, "meta.ping", serde_json::json!({}));
        let s = serde_json::to_string(&r).unwrap();
        assert!(s.contains(r#""method":"meta.ping""#));
        assert!(s.contains(r#""id":1"#));
    }
}
