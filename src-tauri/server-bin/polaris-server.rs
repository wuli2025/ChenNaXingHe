//! Docker(server) 外壳入口：起 tokio 运行时，调 server::serve()。
//!
//! 注意：本文件刻意放在主包 src/ 之外（server-bin/），且主 Cargo.toml 里
//! [[bin]] polaris-server 保持注释状态——否则 cargo autobins/tauri bundler 会把
//! 它当桌面二进制连坐打进安装包（见 Cargo.toml 内说明）。
//! Docker 构建时由 Dockerfile 在容器内追加该 [[bin]] 段后编译：
//!   cargo build --release --bin polaris-server --no-default-features --features server

#[cfg(feature = "server")]
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    polaris_app_lib::server::serve().await
}

#[cfg(not(feature = "server"))]
fn main() {
    eprintln!("polaris-server 需以 `--no-default-features --features server` 构建；桌面版请运行 polaris-app。");
    std::process::exit(1);
}
