/* THIS FILE IS AUTO-GENERATED. DO NOT MODIFY!! */

// Copyright 2020-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

package com.notepod.app

import android.net.Uri
import android.webkit.*
import android.content.Context
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import androidx.webkit.WebViewAssetLoader

class RustWebViewClient(webView: RustWebView, context: Context): WebViewClient() {
    private val interceptedState = mutableMapOf<String, Boolean>()
    var currentUrl: String = "about:blank"
    private var lastInterceptedUrl: Uri? = null
    private var pendingUrlRedirect: String? = null

    private val assetLoader = WebViewAssetLoader.Builder()
        // 硬编码 tauri.localhost，与 tauri.android.conf.json 的 devUrl 域名匹配
        .setDomain("tauri.localhost")
        .setHttpAllowed(true)
        .addPathHandler("/", object : WebViewAssetLoader.PathHandler {
            override fun handle(path: String): WebResourceResponse? {
                // 把根路径 "/" 映射到 assets/index.html
                val finalPath = if (path == "/" || path.isEmpty()) "/index.html" else path
                return WebViewAssetLoader.AssetsPathHandler(context)
                    .handle(finalPath)
            }
        })
        .build()

    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest
    ): WebResourceResponse? {
        pendingUrlRedirect?.let {
            Handler(Looper.getMainLooper()).post {
              view.loadUrl(it)
            }
            pendingUrlRedirect = null
            return null
        }

        lastInterceptedUrl = request.url
        // Android release 模式：强制走 WebViewAssetLoader 加载本地 assets，
        // 避免 Rust.handleRequest 走 custom protocol 路由失败导致 ERR_CONNECTION_REFUSED。
        // Tauri 的 default devUrl 是 https://tauri.localhost，loader 的 domain 也是 tauri.localhost，
        // 所以会直接命中；根路径 "/" 由自定义 PathHandler 映射到 assets/index.html。
        return assetLoader.shouldInterceptRequest(request.url)
    }

    override fun shouldOverrideUrlLoading(
        view: WebView,
        request: WebResourceRequest
    ): Boolean {
        return Rust.shouldOverride((view as RustWebView).id, request.url.toString())
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        currentUrl = url
        if (interceptedState[url] == false) {
            val webView = view as RustWebView
            for (script in webView.initScripts) {
                view.evaluateJavascript(script, null)
            }
        }
        return Rust.onPageLoading((view as RustWebView).id, url)
    }

    override fun onPageFinished(view: WebView, url: String) {
        Rust.onPageLoaded((view as RustWebView).id, url)
    }

    override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceError
    ) {
        // we get a net::ERR_CONNECTION_REFUSED when an external URL redirects to a custom protocol
        // e.g. oauth flow, because shouldInterceptRequest is not called on redirects
        // so we must force retry here with loadUrl() to get a chance of the custom protocol to kick in
        // Also handle DNS lookup errors (ERR_HOST_LOOKUP) on main frame initial navigation,
        // where shouldInterceptRequest may not be called by some WebView versions.
        if (request.isForMainFrame && request.url != lastInterceptedUrl) {
            // prevent the default error page from showing
            view.stopLoading()
            // without this initial loadUrl the app is stuck
            view.loadUrl(request.url.toString())
            // NOTE: don't set pendingUrlRedirect here, otherwise the retry's
            // shouldInterceptRequest will short-circuit and return null again.
            // Just let the second loadUrl go through normal interception.
        } else {
            super.onReceivedError(view, request, error)
        }
    }

    
}
