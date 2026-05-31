# tau serve wire contract v1 — snapshot @ tau 58f6ba6

## Wire contract (reconciled — this is what the mock implements and the adapter parses)

NDJSON: one JSON object per line, `\n`-delimited, UTF-8. stdin = requests; stdout = responses + notifications; stderr = logs + the ready line.

```jsonc
// startup: child writes to STDERR exactly:  tau-serve ready\n   (when --ready-on-stderr)

// handshake (must be first)
→ {"jsonrpc":"2.0","id":1,"method":"meta.handshake","params":{"client_name":"tau-gateway","client_version":"0.1.0","protocol_version":1}}
← {"jsonrpc":"2.0","id":1,"result":{"server_name":"tau","server_version":"0.0.0","protocol_version":1,"project_path":"/abs","agents":["greeter","researcher"]}}

// ping
→ {"jsonrpc":"2.0","id":2,"method":"meta.ping"}
← {"jsonrpc":"2.0","id":2,"result":{"ok":true}}

// streaming run — emits N runtime.event notifications (params.id == request id), then a final result
→ {"jsonrpc":"2.0","id":4,"method":"runtime.run_streaming","params":{"agent":"greeter","prompt":"hi"}}
← {"jsonrpc":"2.0","method":"runtime.event","params":{"id":4,"kind":"TextDelta","data":{"text":"He"}}}
← {"jsonrpc":"2.0","method":"runtime.event","params":{"id":4,"kind":"ToolCallStarted","data":{"tool":"fs-read","call_id":"c1","args":{"path":"/x"}}}}
← {"jsonrpc":"2.0","method":"runtime.event","params":{"id":4,"kind":"ToolCallCompleted","data":{"tool":"fs-read","call_id":"c1","result":{"ok":true,"content":[{"type":"text","text":"…"}],"is_error":false}}}}
← {"jsonrpc":"2.0","method":"runtime.event","params":{"id":4,"kind":"TurnCompleted","data":{"turn":1,"stop_reason":"end_turn","usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}}
← {"jsonrpc":"2.0","method":"runtime.event","params":{"id":4,"kind":"RunCompleted","data":{"token_usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}}
← {"jsonrpc":"2.0","id":4,"result":{"final":true,"token_usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15},"stop_reason":"end_turn"}}

// cancel — the cancelled call gets a -32001 error on its ORIGINAL id
→ {"jsonrpc":"2.0","id":5,"method":"runtime.cancel","params":{"id":4}}
← {"jsonrpc":"2.0","id":5,"result":{"cancelled":true}}
← {"jsonrpc":"2.0","id":4,"error":{"code":-32001,"message":"Cancelled by client"}}

// fatal error mid-stream — terminates the streaming call with an error response
← {"jsonrpc":"2.0","method":"runtime.event","params":{"id":4,"kind":"FatalError","data":{"tool_error_variant":"…","message":"…","context_json":"…"}}}
← {"jsonrpc":"2.0","id":4,"error":{"code":-32008,"message":"Tool error: …","data":{…}}}
```

Error codes: `-32700` parse · `-32600` invalid request · `-32601` method not found · `-32602` invalid params · `-32603` internal · `-32000` handshake mismatch (`data.supported_versions:[1]`) · `-32001` cancelled · `-32002` handshake required · `-32003` already handshaken · `-32004` server busy · `-32005` project · `-32006` runtime · `-32007` capability denied · `-32008` tool · `-32009` llm · `-32010` unknown agent.

**Assumptions made where tau's doc is silent or self-inconsistent (document these in `docs/tau-contract-v1.md`):**
- `RunEvent` is `#[non_exhaustive]` upstream → the adapter must render unknown `kind` values generically, never panic.
- `TurnCompleted.data.usage` may be present or `null`; the doc's §5.4 omits `usage` but `RunEvent::TurnCompleted` carries `Option<TokenUsage>`. We tolerate both.
- Batch `runtime.run` token_usage is keyed `{prompt, completion}` while streaming uses `{input_tokens, output_tokens, total_tokens}`. The gateway only uses `run_streaming`; we normalize all token usage to `{input_tokens, output_tokens, total_tokens}` (total optional).
- `ToolCallCompleted.data.result` is either `{ok:true, content:[…], is_error:bool}` or `{ok:false, error:"…"}`. Span status is `error` iff `ok==false` or `is_error==true`.
