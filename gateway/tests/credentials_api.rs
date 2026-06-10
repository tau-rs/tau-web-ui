use std::path::PathBuf;
use tau_gateway::{api, projects::ProjectRegistry};

fn bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}

async fn serve(reg: ProjectRegistry) -> String {
    let app = api::router(reg);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn credentials_crud_over_http() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();

    // PUT a Local source with a value → resolves via local, no value echoed
    let put = http
        .put(format!("{base}/api/credentials/anthropic"))
        .json(&serde_json::json!({ "sources": [{ "kind": "local" }], "local_value": "sk-test" }))
        .send()
        .await
        .unwrap();
    assert_eq!(put.status(), reqwest::StatusCode::OK);
    let st: serde_json::Value = put.json().await.unwrap();
    assert_eq!(st["resolved"], true);
    assert_eq!(st["resolved_via"], "local");
    assert!(!serde_json::to_string(&st).unwrap().contains("sk-test"));

    // GET list shows it, still no value
    let list: serde_json::Value = http
        .get(format!("{base}/api/credentials"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let a = list
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["backend"] == "anthropic")
        .unwrap();
    assert_eq!(a["resolved_via"], "local");
    assert!(!serde_json::to_string(&list).unwrap().contains("sk-test"));

    // env source with an unset var → not configured
    let st2: serde_json::Value = http
        .put(format!("{base}/api/credentials/openai"))
        .json(&serde_json::json!({ "sources": [{ "kind": "env", "ref": "TAU_UNSET_VAR_QWZ" }] }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(st2["resolved"], false);
    assert_eq!(st2["sources"][0]["gated"], false);

    // CR-2: a vault source is now accepted (200), ungated, with a detail hint.
    let v = http
        .put(format!("{base}/api/credentials/vaulted"))
        .json(&serde_json::json!({ "sources": [{ "kind": "vault", "ref": "secret/data/x" }] }))
        .send()
        .await
        .unwrap();
    assert_eq!(v.status(), reqwest::StatusCode::OK);
    let vst: serde_json::Value = v.json().await.unwrap();
    assert_eq!(vst["sources"][0]["gated"], false);
    // VAULT_ADDR is typically unset in CI → not configured + a detail hint. Don't hard-assert
    // the ambient-env-dependent `configured`; just check that an unconfigured source has a detail.
    if vst["sources"][0]["configured"] == false {
        assert!(vst["sources"][0]["detail"].is_string());
    }

    // a gated kind (token_broker) → 422
    let gated = http
        .put(format!("{base}/api/credentials/x"))
        .json(&serde_json::json!({ "sources": [{ "kind": "token_broker", "ref": "https://b" }] }))
        .send()
        .await
        .unwrap();
    assert_eq!(gated.status(), reqwest::StatusCode::UNPROCESSABLE_ENTITY);

    // a manager with an empty ref → 422
    let empty = http
        .put(format!("{base}/api/credentials/x"))
        .json(&serde_json::json!({ "sources": [{ "kind": "vault" }] }))
        .send()
        .await
        .unwrap();
    assert_eq!(empty.status(), reqwest::StatusCode::UNPROCESSABLE_ENTITY);

    // DELETE clears
    let del = http
        .delete(format!("{base}/api/credentials/anthropic"))
        .send()
        .await
        .unwrap();
    assert_eq!(del.status(), reqwest::StatusCode::OK);
    let list2: serde_json::Value = http
        .get(format!("{base}/api/credentials"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(list2
        .as_array()
        .unwrap()
        .iter()
        .all(|c| c["backend"] != "anthropic"));
}
