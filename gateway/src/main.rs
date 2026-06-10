use std::path::PathBuf;

use tau_gateway::{api, projects::ProjectRegistry};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_writer(std::io::stderr)
        .init();

    let args: Vec<String> = std::env::args().collect();
    let project = flag(&args, "--project").map(PathBuf::from);
    let bin = flag(&args, "--tau-bin")
        .map(PathBuf::from)
        .or_else(|| std::env::var("TAU_BIN").ok().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("tau"));
    let no_sandbox = args.iter().any(|a| a == "--no-sandbox");
    let serve_kind = flag(&args, "--serve-kind"); // "real" | "mock" | None (autodetect)
    let is_mock_override = serve_kind
        .as_deref()
        .map(|k| k.eq_ignore_ascii_case("mock"));
    let port: u16 = flag(&args, "--port")
        .and_then(|p| p.parse().ok())
        .unwrap_or(4317);

    let data_root = data_root();
    let reg = ProjectRegistry::load_with_kind(bin, no_sandbox, data_root, is_mock_override).await?;

    // Auto-register the --project path (or the cwd if none given) so the existing
    // single-project launch still lands on a usable project.
    let initial = project.unwrap_or_else(|| std::env::current_dir().unwrap());
    if let Err(e) = reg.add_local(&initial).await {
        tracing::warn!("could not auto-register {}: {e}", initial.display());
    }

    let app = api::router(reg);
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    tracing::info!("tau-gateway listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn data_root() -> PathBuf {
    match std::env::var("HOME") {
        Ok(home) => PathBuf::from(home).join(".tau-web-ui"),
        Err(_) => {
            tracing::warn!("$HOME unset; storing data under ./.tau-web-ui (relative to cwd)");
            PathBuf::from(".tau-web-ui")
        }
    }
}
