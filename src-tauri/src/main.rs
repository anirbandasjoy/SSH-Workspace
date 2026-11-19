#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod config;
mod native;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

static CONFIG_LOCK: Mutex<()> = Mutex::new(());
fn dispatch(name: &str, payload: Value) -> Result<Value, String> {
    // Slow connection checks run independently of the file transaction lock.
    match name {
        "env_info" => return native::env_info(),
        "inspect" => return native::inspect(payload),
        "keys" => return native::keys(),
        "public_key" => return native::public_key(payload),
        "hosts" => return native::hosts(),
        "test_connection" => return native::test_connection(payload),
        "scan_repos" => return native::scan_repos(payload),
        _ => {}
    }
    let _guard = CONFIG_LOCK
        .lock()
        .map_err(|_| "Workspace operation interrupted. Reopen the app.")?;
    match name {
        "generate_key" => native::generate_key(payload),
        "agent_key" => native::agent_key(payload),
        "delete_key" => native::delete_key(payload),
        "state" => config::state(),
        "preview" => config::preview(payload),
        "apply" => config::apply(payload),
        "undo" => config::undo(),
        "clone_repo" => native::clone_repo(payload),
        "open_repo" => {
            let repository = native::inspect(payload)?;
            let root = repository["path"]
                .as_str()
                .ok_or("Invalid repository path.")?;
            config::remember_repo(root)?;
            Ok(repository)
        }
        "forget_repo" => {
            config::forget_repo(payload["path"].as_str().ok_or("Missing path.")?)?;
            Ok(json!(true))
        }
        _ => Err("Unknown workspace operation.".into()),
    }
}

#[tauri::command]
async fn workspace(name: String, payload: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || dispatch(&name, payload))
        .await
        .map_err(|_| "Workspace operation interrupted.".to_string())?
}

#[tauri::command]
fn open_github_settings(app: tauri::AppHandle) -> Result<(), String> {
    app.opener()
        .open_url("https://github.com/settings/ssh/new", None::<&str>)
        .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![workspace, open_github_settings])
        .run(tauri::generate_context!())
        .expect("SSH Workspace could not start");
}
