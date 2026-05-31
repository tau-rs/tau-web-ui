use std::path::PathBuf;

use tau_gateway::{api, state::AppState, store::RunStore};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_writer(std::io::stderr)
        .init();

    let args: Vec<String> = std::env::args().collect();
    let project = flag(&args, "--project")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap());
    let bin = flag(&args, "--tau-bin")
        .map(PathBuf::from)
        .or_else(|| std::env::var("TAU_BIN").ok().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("tau"));
    let no_sandbox = args.iter().any(|a| a == "--no-sandbox");
    let port: u16 = flag(&args, "--port")
        .and_then(|p| p.parse().ok())
        .unwrap_or(4317);

    let data_dir = dirs_data_dir();
    let store = RunStore::new(&data_dir)?;
    let state = AppState::new(bin, project, no_sandbox, store);
    state.rehydrate().await?;

    let app = api::router(state);
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

fn dirs_data_dir() -> PathBuf {
    match std::env::var("HOME") {
        Ok(home) => PathBuf::from(home).join(".tau-web-ui/runs"),
        Err(_) => {
            tracing::warn!(
                "$HOME unset; storing run data under ./.tau-web-ui/runs (relative to cwd)"
            );
            PathBuf::from(".tau-web-ui/runs")
        }
    }
}
