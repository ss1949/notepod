use crate::error::AppError;

/// 设置状态栏样式（Android：控制图标颜色；其他平台忽略）
#[tauri::command]
pub fn set_status_bar_style(dark_mode: bool) -> Result<(), AppError> {
    #[cfg(target_os = "android")]
    {
        use tauri::AppHandle;
        use tauri::Runtime;
        // 在 Android 上通过 WindowInsetsController 设置状态栏图标颜色
        // 此 API 通过 Android 的 JNI 调用
    }
    Ok(())
}
