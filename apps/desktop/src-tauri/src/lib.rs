use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                let _ = start_server();
            }
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Aether");
}

#[cfg(desktop)]
fn start_server() {
    std::thread::spawn(|| {
        let _ = std::process::Command::new("node")
            .args(["../../packages/server/dist/index.js"])
            .env("AETHER_PORT", "3847")
            .spawn();
    });
}