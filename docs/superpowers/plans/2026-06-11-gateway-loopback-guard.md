# Gateway loopback Origin/Host guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject any HTTP request or WS upgrade whose `Host` is non-loopback or whose `Origin` (when present) is non-loopback, closing the gateway's CSRF / DNS-rebinding surface without breaking the local UI.

**Architecture:** One `axum::middleware::from_fn` layered over the whole router in `api::router`. Pure helpers `host_is_loopback`/`origin_is_loopback` live in a new `gateway/src/api/guard.rs` with unit tests; an integration test exercises a sensitive route and the WS upgrade.

**Tech Stack:** Rust, axum 0.8, http 1.4, tokio, reqwest + tokio-tungstenite (dev-deps).

---

### Task 1: Pure guard helpers + middleware

**Files:**
- Create: `gateway/src/api/guard.rs`
- Modify: `gateway/src/api/mod.rs` (add `pub mod guard;` and `.layer(...)`)

- [ ] **Step 1: Write `gateway/src/api/guard.rs` with helpers, middleware, and unit tests**

```rust
//! Loopback guard: rejects requests whose `Host` is non-loopback or whose `Origin`
//! (when present) is non-loopback. Layered over the whole router so it uniformly
//! guards every HTTP route and the WS upgrade, closing the CSRF / DNS-rebinding
//! surface of the localhost gateway. See audit/security.md S1.

use std::net::IpAddr;

use axum::{
    body::Body,
    extract::Request,
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};

/// Strip an optional `:port`, handling bracketed IPv6 (`[::1]:4317` -> `::1`).
fn strip_port(authority: &str) -> &str {
    let a = authority.trim();
    if let Some(rest) = a.strip_prefix('[') {
        // [host]:port  ->  host
        return rest.split(']').next().unwrap_or(rest);
    }
    // host:port -> host  (only when exactly one ':', i.e. not a bare IPv6 literal)
    match a.rsplit_once(':') {
        Some((host, _port)) if !host.contains(':') => host,
        _ => a,
    }
}

/// True if `authority` (host[:port]) names the loopback interface.
pub fn host_is_loopback(authority: &str) -> bool {
    let host = strip_port(authority);
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    host.parse::<IpAddr>().map(|ip| ip.is_loopback()).unwrap_or(false)
}

/// True if `origin` is an `http`/`https` URL whose host is loopback.
/// `Origin: null` and any non-loopback origin return false.
pub fn origin_is_loopback(origin: &str) -> bool {
    let authority = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"));
    match authority {
        Some(authority) => host_is_loopback(authority),
        None => false,
    }
}

fn header_str<'a>(req: &'a Request, name: header::HeaderName) -> Option<&'a str> {
    req.headers().get(name).and_then(|v| v.to_str().ok())
}

/// Reject non-loopback `Host` (defeats DNS-rebinding) and non-loopback `Origin`
/// when present (defeats CSRF). Absent `Origin` is allowed; the `Host` check still
/// protects against rebinding.
pub async fn loopback_guard(req: Request, next: Next) -> Response {
    let host_ok = header_str(&req, header::HOST)
        .or_else(|| req.uri().host())
        .map(host_is_loopback)
        .unwrap_or(false);
    if !host_ok {
        return forbidden("non-loopback Host rejected");
    }
    if let Some(origin) = header_str(&req, header::ORIGIN) {
        if !origin_is_loopback(origin) {
            return forbidden("non-loopback Origin rejected");
        }
    }
    next.run(req).await
}

fn forbidden(msg: &'static str) -> Response {
    (StatusCode::FORBIDDEN, Body::from(msg)).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_hosts_allowed() {
        for h in ["127.0.0.1", "127.0.0.1:4317", "localhost", "LOCALHOST:5173",
                  "[::1]", "[::1]:4317", "127.0.0.5:80"] {
            assert!(host_is_loopback(h), "expected loopback: {h}");
        }
    }

    #[test]
    fn foreign_hosts_rejected() {
        for h in ["evil.com", "evil.com:4317", "10.0.0.1", "0.0.0.0",
                  "169.254.1.1", "8.8.8.8:80"] {
            assert!(!host_is_loopback(h), "expected rejected: {h}");
        }
    }

    #[test]
    fn loopback_origins_allowed() {
        for o in ["http://127.0.0.1:5173", "http://localhost:5173",
                  "https://127.0.0.1", "http://[::1]:4317"] {
            assert!(origin_is_loopback(o), "expected loopback: {o}");
        }
    }

    #[test]
    fn foreign_or_null_origins_rejected() {
        for o in ["http://evil.com", "https://evil.com:4317", "null",
                  "file://", "ws://127.0.0.1"] {
            assert!(!origin_is_loopback(o), "expected rejected: {o}");
        }
    }
}
```

- [ ] **Step 2: Run the unit tests to verify they pass**

Run: `cargo test -p tau-gateway --lib guard`
Expected: 4 tests pass (after Step 3 wires the module in; if `mod guard` is not yet declared the file is not compiled — do Step 3 first, then run).

- [ ] **Step 3: Wire the module and layer into `gateway/src/api/mod.rs`**

Add to the `pub mod ...;` block (alphabetical, after `graph`):

```rust
pub mod guard;
```

Change the imports:

```rust
use axum::{
    middleware,
    routing::{delete, get, post, put},
    Router,
};
```

Add the layer to the returned router (the final `Router::new()...with_state(reg)` chain) — append `.layer(...)` as the **last** call so the guard wraps every route:

```rust
        .nest("/api/projects/{pid}", scoped)
        .with_state(reg)
        .layer(middleware::from_fn(guard::loopback_guard))
}
```

- [ ] **Step 4: Run lib tests + format**

Run: `cargo test -p tau-gateway --lib guard && cargo fmt -p tau-gateway`
Expected: 4 tests pass; no diff after fmt (or fmt cleans whitespace).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/api/guard.rs gateway/src/api/mod.rs
git commit -m "feat(gateway): loopback Origin/Host guard middleware"
```

---

### Task 2: Integration tests (HTTP + WS)

**Files:**
- Create: `gateway/tests/gateway_guard.rs`

- [ ] **Step 1: Write the failing/should-pass integration test**

```rust
//! Integration coverage for the loopback Origin/Host guard (audit S1).
use std::path::PathBuf;
use tau_gateway::{api, projects::ProjectRegistry};

fn bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}

async fn serve() -> (String, std::net::SocketAddr) {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    // keep tempdir alive for the test process
    std::mem::forget(data);
    let app = api::router(reg);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{addr}"), addr)
}

#[tokio::test]
async fn foreign_origin_rejected_on_sensitive_route() {
    let (base, _) = serve().await;
    let res = reqwest::Client::new()
        .post(format!("{base}/api/projects"))
        .header("origin", "http://evil.com")
        .json(&serde_json::json!({ "path": "/tmp/whatever" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn foreign_host_rejected() {
    let (base, _) = serve().await;
    // Simulate DNS-rebinding: connect to loopback but send a foreign Host header.
    let res = reqwest::Client::new()
        .get(format!("{base}/api/projects"))
        .header("host", "evil.com")
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn loopback_origin_allowed() {
    let (base, _) = serve().await;
    let res = reqwest::Client::new()
        .get(format!("{base}/api/projects"))
        .header("origin", "http://127.0.0.1:5173")
        .send()
        .await
        .unwrap();
    assert!(res.status().is_success(), "got {}", res.status());
}

#[tokio::test]
async fn ws_upgrade_foreign_origin_rejected() {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let (_, addr) = serve().await;
    let url = format!("ws://{addr}/api/projects/demo/runs/x/events");
    let mut req = url.into_client_request().unwrap();
    req.headers_mut()
        .insert("origin", "http://evil.com".parse().unwrap());
    let err = tokio_tungstenite::connect_async(req).await;
    assert!(err.is_err(), "expected the WS handshake to be rejected");
}
```

- [ ] **Step 2: Build the fake-tau-serve fixture the tests launch**

Run: `cargo build -p fake-tau-serve`
Expected: produces `target/debug/fake-tau-serve` (the integration tests exec it).

- [ ] **Step 3: Run the integration tests**

Run: `cargo test -p tau-gateway --test gateway_guard`
Expected: 4 tests pass. (`reqwest` honors a manually-set `host` header; if it does not on this version, the `foreign_host_rejected` assert will surface it — see note below.)

- [ ] **Step 4: Run the full gateway test suite to confirm no regression**

Run: `cargo test -p tau-gateway`
Expected: all tests pass, including the existing `ws_e2e` (WS with no Origin still streams).

- [ ] **Step 5: Format + commit**

```bash
cargo fmt -p tau-gateway
git add gateway/tests/gateway_guard.rs
git commit -m "test(gateway): cover loopback Origin/Host guard on HTTP + WS"
```

---

## Notes / risks

- **reqwest custom Host:** reqwest 0.12 sends a manually-inserted `host` header as-is. If
  a future version strips it, replace `foreign_host_rejected` with a raw `tokio::net::TcpStream`
  that writes `GET /api/projects HTTP/1.1\r\nHost: evil.com\r\n\r\n` and asserts the
  status line is `403`.
- **Origin absent on same-origin GET:** allowed by design; the Host check is the
  rebinding backstop. The legit Vite proxy sets `Host: 127.0.0.1:4317`.
- Guard is layered as the outermost middleware so it runs before routing/extractors and
  covers the WS upgrade GET.
