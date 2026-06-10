//! Loopback guard: rejects requests whose `Host` is non-loopback or whose `Origin`
//! (when present) is non-loopback. Layered over the whole router so it uniformly
//! guards every HTTP route and the WS upgrade, closing the CSRF / DNS-rebinding
//! surface of the localhost gateway. See `audit/security.md` S1.

use std::net::IpAddr;

use axum::{
    extract::Request,
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};

/// Strip an optional `:port`, handling bracketed IPv6 (`[::1]:4317` -> `::1`).
fn strip_port(authority: &str) -> &str {
    let a = authority.trim();
    if let Some(rest) = a.strip_prefix('[') {
        // `[host]:port` -> `host`
        return rest.split(']').next().unwrap_or(rest);
    }
    // `host:port` -> `host`, but leave a bare IPv6 literal (many colons) untouched.
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
    host.parse::<IpAddr>()
        .map(|ip| ip.is_loopback())
        .unwrap_or(false)
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

fn header_str(req: &Request, name: header::HeaderName) -> Option<&str> {
    req.headers().get(name).and_then(|v| v.to_str().ok())
}

/// Reject non-loopback `Host` (defeats DNS-rebinding) and non-loopback `Origin`
/// when present (defeats CSRF). An absent `Origin` is allowed — non-browser
/// clients and same-origin GETs omit it, and the `Host` check still blocks
/// rebinding.
pub async fn loopback_guard(req: Request, next: Next) -> Response {
    let host_ok = header_str(&req, header::HOST)
        // Fallback for HTTP/2, which carries the authority in `:authority`
        // (reconstructed into the URI) rather than a literal `Host` header.
        .or_else(|| req.uri().host())
        .map(host_is_loopback)
        .unwrap_or(false);
    if !host_ok {
        return (StatusCode::FORBIDDEN, "non-loopback Host rejected").into_response();
    }
    if let Some(origin) = header_str(&req, header::ORIGIN) {
        if !origin_is_loopback(origin) {
            return (StatusCode::FORBIDDEN, "non-loopback Origin rejected").into_response();
        }
    }
    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_hosts_allowed() {
        for h in [
            "127.0.0.1",
            "127.0.0.1:4317",
            "localhost",
            "LOCALHOST:5173",
            "[::1]",
            "[::1]:4317",
            "127.0.0.5:80",
        ] {
            assert!(host_is_loopback(h), "expected loopback: {h}");
        }
    }

    #[test]
    fn foreign_hosts_rejected() {
        for h in [
            "evil.com",
            "evil.com:4317",
            "10.0.0.1",
            "0.0.0.0",
            "169.254.1.1",
            "8.8.8.8:80",
            // IPv4-mapped IPv6 must NOT be treated as loopback — guards against
            // smuggling 127.0.0.1 through an IPv6 literal.
            "::ffff:127.0.0.1",
            "[::ffff:127.0.0.1]",
            // Non-IP encodings that must fail to parse rather than resolve to loopback.
            "2130706433",
            "127.0.0.1.evil.com",
            "localhost.evil.com",
        ] {
            assert!(!host_is_loopback(h), "expected rejected: {h}");
        }
    }

    #[test]
    fn loopback_origins_allowed() {
        for o in [
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "https://127.0.0.1",
            "http://[::1]:4317",
        ] {
            assert!(origin_is_loopback(o), "expected loopback: {o}");
        }
    }

    #[test]
    fn foreign_or_null_origins_rejected() {
        for o in [
            "http://evil.com",
            "https://evil.com:4317",
            "null",
            "file://",
            "ws://127.0.0.1",
        ] {
            assert!(!origin_is_loopback(o), "expected rejected: {o}");
        }
    }
}
