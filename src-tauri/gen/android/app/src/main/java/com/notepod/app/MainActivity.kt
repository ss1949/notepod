package com.notepod.app

import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowInsetsController
import androidx.activity.enableEdgeToEdge
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  companion object {
    var instance: MainActivity? = null
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    instance = this
    Handler(Looper.getMainLooper()).post {
      updateStatusBarStyle(resources.configuration.uiMode and
        android.content.res.Configuration.UI_MODE_NIGHT_MASK ==
        android.content.res.Configuration.UI_MODE_NIGHT_YES)
    }
  }

  override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
    super.onConfigurationChanged(newConfig)
    updateStatusBarStyle(newConfig.uiMode and
      android.content.res.Configuration.UI_MODE_NIGHT_MASK ==
      android.content.res.Configuration.UI_MODE_NIGHT_YES)
  }

  /** 被 NotePodStatusBarBridge（RustWebView.kt）调用的静态方法 */
  fun updateStatusBarStyle(isDark: Boolean) {
    window?.let { win ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        win.insetsController?.let { ctrl ->
          if (isDark) ctrl.setSystemBarsAppearance(0,
            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS)
          else ctrl.setSystemBarsAppearance(
            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS)
        }
      } else {
        @Suppress("DEPRECATION")
        if (isDark) win.decorView.systemUiVisibility =
          win.decorView.systemUiVisibility and
          android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
        else win.decorView.systemUiVisibility =
          win.decorView.systemUiVisibility or
          android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
      }
    }
  }
}
