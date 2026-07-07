# THIS FILE IS AUTO-GENERATED. DO NOT MODIFY!!

# Copyright 2020-2023 Tauri Programme within The Commons Conservancy
# SPDX-License-Identifier: Apache-2.0
# SPDX-License-Identifier: MIT

-keep class com.notepod.app.* {
  native <methods>;
}

-keep class com.notepod.app.WryActivity {
  public <init>(...);

  void setWebView(com.notepod.app.RustWebView);
  java.lang.Class getAppClass(...);
  int getId();
  java.lang.String getVersion();
  int startActivity(...);
}

-keep class com.notepod.app.Ipc {
  public <init>(...);

  @android.webkit.JavascriptInterface public <methods>;
}

-keep class com.notepod.app.RustWebView {
  public <init>(...);

  void loadUrlMainThread(...);
  void loadHTMLMainThread(...);
  void evalScript(...);
}

-keep class com.notepod.app.RustWebChromeClient,com.notepod.app.RustWebViewClient {
  public <init>(...);
}
