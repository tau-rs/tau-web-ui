//! Faithful mock of the `tau serve` wire protocol (NDJSON JSON-RPC over stdio).
//! Implements the contract snapshotted in tau-web-ui/docs/tau-contract-v1.md.
//! Flags: --project <path> --ready-on-stderr [--max-concurrent N] [--idle-timeout S]

mod scripts;

use serde_json::{json, Value};
use std::io::Write as _;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let project = flag(&args, "--project").unwrap_or_else(|| ".".into());
    let ready_on_stderr = args.iter().any(|a| a == "--ready-on-stderr");

    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();
    let mut stdout = tokio::io::stdout();

    if ready_on_stderr {
        eprint!("tau-serve ready\n");
        std::io::stderr().flush().ok();
    }

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                write_line(&mut stdout, &err_response(&Value::Null, -32700, "Parse error")).await?;
                continue;
            }
        };
        let id = req.get("id").cloned().unwrap_or(Value::Null);
        let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");

        match method {
            "meta.handshake" => {
                let pv = req["params"]["protocol_version"].as_i64().unwrap_or(1);
                if pv != 1 {
                    let mut e = err_response(&id, -32000, "Handshake mismatch");
                    e["error"]["data"] = json!({"supported_versions": [1]});
                    write_line(&mut stdout, &e).await?;
                    continue;
                }
                let resp = json!({
                    "jsonrpc": "2.0", "id": id,
                    "result": {
                        "server_name": "tau", "server_version": "0.0.0-mock",
                        "protocol_version": 1, "project_path": project,
                        "agents": ["greeter", "researcher"]
                    }
                });
                write_line(&mut stdout, &resp).await?;
            }
            "meta.ping" => {
                write_line(&mut stdout, &json!({"jsonrpc":"2.0","id":id,"result":{"ok":true}})).await?;
            }
            "runtime.run_streaming" => {
                // Task 4 fills this in.
                write_line(&mut stdout, &err_response(&id, -32601, "Method not found")).await?;
            }
            "runtime.cancel" => {
                write_line(&mut stdout, &json!({"jsonrpc":"2.0","id":id,"result":{"cancelled":false}})).await?;
            }
            _ => {
                write_line(&mut stdout, &err_response(&id, -32601, "Method not found")).await?;
            }
        }
    }
    Ok(())
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn err_response(id: &Value, code: i64, msg: &str) -> Value {
    json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":msg}})
}

async fn write_line(out: &mut tokio::io::Stdout, v: &Value) -> anyhow::Result<()> {
    let mut s = serde_json::to_string(v)?;
    s.push('\n');
    out.write_all(s.as_bytes()).await?;
    out.flush().await?;
    Ok(())
}
