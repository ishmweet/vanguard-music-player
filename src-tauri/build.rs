fn main() {
    #[cfg(target_os = "windows")]
    {
        println!("cargo:rustc-link-arg-bins=/SUBSYSTEM:windows");
        println!("cargo:rustc-link-arg-bins=/ENTRY:mainCRTStartup");
    }
    tauri_build::build()
}