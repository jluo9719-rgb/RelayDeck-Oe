package com.relaydeck.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.CookieManager
import android.webkit.JsResult
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {

    companion object {
        private const val PREFS_NAME = "relaydeck_prefs"
        private const val KEY_ACTIVE_NODE = "active_node"
        private const val KEY_CLOUD_URL = "cloud_url"
        private const val KEY_HOME_URL = "home_url"

        private const val NODE_CLOUD = "cloud"
        private const val NODE_HOME = "home"

        private const val DEFAULT_CLOUD_URL = "https://cloud.example.com"
        private const val DEFAULT_HOME_URL = "https://agent.example.com"

        private const val FILE_CHOOSER_REQUEST_CODE = 1001
    }

    private lateinit var rootLayout: LinearLayout
    private lateinit var cloudTabBtn: TextView
    private lateinit var homeTabBtn: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var webContainer: FrameLayout
    private lateinit var errorOverlay: LinearLayout
    private lateinit var errorSubtitle: TextView
    private lateinit var errorSwitchBtn: TextView

    private var cloudWebView: WebView? = null
    private var homeWebView: WebView? = null
    private var cloudHasError = false
    private var homeHasError = false

    private var activeNode: String = NODE_CLOUD
    private var lastBackPressedAt: Long = 0L
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        activeNode = prefs.getString(KEY_ACTIVE_NODE, NODE_CLOUD) ?: NODE_CLOUD

        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)

        buildUi()
        setContentView(rootLayout)

        // Ensure crisp white status/nav icons on dark slate top bar
        rootLayout.post {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                window.insetsController?.setSystemBarsAppearance(
                    0,
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                        WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                )
            }
        }

        // Handle Android 11-16 (HyperOS / MIUI) system bars + soft keyboard insets cleanly
        rootLayout.setOnApplyWindowInsetsListener { view, insets ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val bars = insets.getInsets(
                    WindowInsets.Type.systemBars() or WindowInsets.Type.ime()
                )
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(
                    insets.systemWindowInsetLeft,
                    insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight,
                    insets.systemWindowInsetBottom
                )
            }
            insets
        }

        switchNode(activeNode, forceReload = false)
    }

    private fun buildUi() {
        val bgDark = Color.parseColor("#0F172A")
        val barSurface = Color.parseColor("#1E293B")
        val borderCol = Color.parseColor("#334155")

        rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(bgDark)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        // Compact native node-switcher bar (46dp)
        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(bgDark)
            setPadding(dp(12), dp(6), dp(10), dp(6))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(46)
            )
        }

        val switcherGroup = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(3), dp(3), dp(3), dp(3))
            background = GradientDrawable().apply {
                setColor(barSurface)
                cornerRadius = dp(10).toFloat()
                setStroke(dp(1), borderCol)
            }
            layoutParams = LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.MATCH_PARENT,
                1f
            )
        }

        cloudTabBtn = createTabButton("24h 云端") {
            switchNode(NODE_CLOUD, forceReload = false)
        }
        homeTabBtn = createTabButton("家里电脑") {
            switchNode(NODE_HOME, forceReload = false)
        }

        switcherGroup.addView(cloudTabBtn)
        switcherGroup.addView(homeTabBtn)

        val refreshBtn = createIconButton("↻") {
            reloadActiveNode()
        }
        val settingsBtn = createIconButton("⚙") {
            showSettingsDialog()
        }

        topBar.addView(switcherGroup)
        topBar.addView(refreshBtn)
        topBar.addView(settingsBtn)

        // Subtle 2dp progress indicator
        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progress = 0
            visibility = View.GONE
            progressTintList = ColorStateList.valueOf(Color.parseColor("#38BDF8"))
            progressBackgroundTintList = ColorStateList.valueOf(barSurface)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(2)
            )
        }

        // Container holding lazy-loaded WebViews + offline error overlay
        webContainer = FrameLayout(this).apply {
            setBackgroundColor(bgDark)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        }

        errorOverlay = buildErrorOverlay()
        webContainer.addView(errorOverlay)

        rootLayout.addView(topBar)
        rootLayout.addView(progressBar)
        rootLayout.addView(webContainer)
    }

    private fun createTabButton(label: String, onClick: () -> Unit): TextView {
        return TextView(this).apply {
            text = label
            gravity = Gravity.CENTER
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            typeface = Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.MATCH_PARENT,
                1f
            )
            setOnClickListener { onClick() }
        }
    }

    private fun createIconButton(symbol: String, onClick: () -> Unit): TextView {
        return TextView(this).apply {
            text = symbol
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#CBD5E1"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            layoutParams = LinearLayout.LayoutParams(dp(38), LinearLayout.LayoutParams.MATCH_PARENT).apply {
                marginStart = dp(4)
            }
            setOnClickListener { onClick() }
        }
    }

    private fun buildErrorOverlay(): LinearLayout {
        val overlay = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#0F172A"))
            setPadding(dp(28), dp(24), dp(28), dp(24))
            visibility = View.GONE
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }

        val title = TextView(this).apply {
            text = "无法连接到当前节点"
            setTextColor(Color.parseColor("#F8FAFC"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        }

        errorSubtitle = TextView(this).apply {
            text = "如果当前选的是「家里电脑」，请确认电脑已开机且 RelayDeck 正在运行。"
            setTextColor(Color.parseColor("#94A3B8"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            gravity = Gravity.CENTER
            setPadding(0, dp(10), 0, dp(22))
        }

        val retryBtn = TextView(this).apply {
            text = "重新加载"
            setTextColor(Color.parseColor("#0F172A"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(12), dp(24), dp(12))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#38BDF8"))
                cornerRadius = dp(10).toFloat()
            }
            layoutParams = LinearLayout.LayoutParams(dp(200), LinearLayout.LayoutParams.WRAP_CONTENT)
            setOnClickListener { reloadActiveNode() }
        }

        errorSwitchBtn = TextView(this).apply {
            text = "切换到 24h 云端"
            setTextColor(Color.parseColor("#E2E8F0"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(11), dp(24), dp(11))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#1E293B"))
                cornerRadius = dp(10).toFloat()
                setStroke(dp(1), Color.parseColor("#334155"))
            }
            layoutParams = LinearLayout.LayoutParams(dp(200), LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(12)
            }
            setOnClickListener {
                val target = if (activeNode == NODE_HOME) NODE_CLOUD else NODE_HOME
                switchNode(target, forceReload = false)
            }
        }

        overlay.addView(title)
        overlay.addView(errorSubtitle)
        overlay.addView(retryBtn)
        overlay.addView(errorSwitchBtn)
        return overlay
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createNodeWebView(node: String): WebView {
        val wv = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#0F172A"))
            overScrollMode = View.OVER_SCROLL_NEVER
        }

        val settings = wv.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.allowFileAccess = false
        settings.allowContentAccess = true
        settings.mediaPlaybackRequiresUserGesture = false
        // Remove "; wv" marker so Cloudflare Access & Turnstile treat it as standard Mobile Chrome
        settings.userAgentString = settings.userAgentString.replace("; wv", "")

        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true)

        wv.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val uri = request?.url ?: return false
                val scheme = uri.scheme?.lowercase() ?: ""
                if (scheme != "http" && scheme != "https") {
                    openExternalUri(uri)
                    return true
                }
                if (isInAppHost(uri.host)) {
                    return false
                }
                openExternalUri(uri)
                return true
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                setNodeError(node, false)
                if (activeNode == node) {
                    progressBar.visibility = View.VISIBLE
                    progressBar.progress = 15
                    updateErrorOverlayVisibility()
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                CookieManager.getInstance().flush()
                if (activeNode == node) {
                    progressBar.visibility = View.GONE
                }
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    setNodeError(node, true)
                    if (activeNode == node) {
                        progressBar.visibility = View.GONE
                        updateErrorOverlayVisibility()
                    }
                }
            }
        }

        wv.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                super.onProgressChanged(view, newProgress)
                if (activeNode == node) {
                    if (newProgress >= 100) {
                        progressBar.visibility = View.GONE
                    } else {
                        progressBar.visibility = View.VISIBLE
                        progressBar.progress = newProgress
                    }
                }
            }

            override fun onJsConfirm(
                view: WebView?,
                url: String?,
                message: String?,
                result: JsResult?
            ): Boolean {
                AlertDialog.Builder(this@MainActivity, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                    .setMessage(message ?: "")
                    .setPositiveButton("确定") { _, _ -> result?.confirm() }
                    .setNegativeButton("取消") { _, _ -> result?.cancel() }
                    .setOnCancelListener { result?.cancel() }
                    .show()
                return true
            }

            override fun onJsAlert(
                view: WebView?,
                url: String?,
                message: String?,
                result: JsResult?
            ): Boolean {
                AlertDialog.Builder(this@MainActivity, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                    .setMessage(message ?: "")
                    .setPositiveButton("知道了") { _, _ -> result?.confirm() }
                    .setOnCancelListener { result?.confirm() }
                    .show()
                return true
            }

            override fun onShowFileChooser(
                webView: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                return try {
                    val intent = fileChooserParams?.createIntent()
                        ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                        }
                    @Suppress("DEPRECATION")
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST_CODE)
                    true
                } catch (_: Exception) {
                    filePathCallback = null
                    false
                }
            }
        }

        // Insert behind errorOverlay so errorOverlay always renders on top when visible
        webContainer.addView(wv, 0)
        return wv
    }

    private fun switchNode(node: String, forceReload: Boolean) {
        activeNode = node
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .edit()
            .putString(KEY_ACTIVE_NODE, node)
            .apply()

        updateTabStyles()

        if (node == NODE_CLOUD) {
            if (cloudWebView == null) {
                cloudWebView = createNodeWebView(NODE_CLOUD)
                cloudWebView?.loadUrl(getCloudUrl())
            } else if (forceReload) {
                cloudWebView?.loadUrl(getCloudUrl())
            }
            cloudWebView?.visibility = View.VISIBLE
            homeWebView?.visibility = View.GONE
        } else {
            if (homeWebView == null) {
                homeWebView = createNodeWebView(NODE_HOME)
                homeWebView?.loadUrl(getHomeUrl())
            } else if (forceReload) {
                homeWebView?.loadUrl(getHomeUrl())
            }
            homeWebView?.visibility = View.VISIBLE
            cloudWebView?.visibility = View.GONE
        }

        progressBar.visibility = View.GONE
        updateErrorOverlayVisibility()
    }

    private fun reloadActiveNode() {
        setNodeError(activeNode, false)
        updateErrorOverlayVisibility()
        val wv = getActiveWebView()
        if (wv == null) {
            switchNode(activeNode, forceReload = true)
            return
        }
        val currentUrl = wv.url
        if (currentUrl.isNullOrBlank() || currentUrl == "about:blank") {
            wv.loadUrl(if (activeNode == NODE_CLOUD) getCloudUrl() else getHomeUrl())
        } else {
            wv.reload()
        }
    }

    private fun updateTabStyles() {
        val activeBg = GradientDrawable().apply {
            setColor(Color.parseColor("#334155"))
            cornerRadius = dp(7).toFloat()
        }
        val activeText = Color.parseColor("#F8FAFC")
        val inactiveText = Color.parseColor("#94A3B8")

        if (activeNode == NODE_CLOUD) {
            cloudTabBtn.background = activeBg
            cloudTabBtn.setTextColor(activeText)
            homeTabBtn.background = null
            homeTabBtn.setTextColor(inactiveText)
        } else {
            homeTabBtn.background = activeBg
            homeTabBtn.setTextColor(activeText)
            cloudTabBtn.background = null
            cloudTabBtn.setTextColor(inactiveText)
        }
    }

    private fun setNodeError(node: String, hasError: Boolean) {
        if (node == NODE_CLOUD) {
            cloudHasError = hasError
        } else {
            homeHasError = hasError
        }
    }

    private fun updateErrorOverlayVisibility() {
        val showError = if (activeNode == NODE_CLOUD) cloudHasError else homeHasError
        if (showError) {
            if (activeNode == NODE_HOME) {
                errorSubtitle.text = "当前无法连接「家里电脑」，请确认 Windows 电脑已开机且 RelayDeck 正在运行。"
                errorSwitchBtn.text = "切换到 24h 云端"
            } else {
                errorSubtitle.text = "当前无法连接「24h 云端」，请检查手机网络连接或稍后重试。"
                errorSwitchBtn.text = "切换到 家里电脑"
            }
            errorOverlay.visibility = View.VISIBLE
        } else {
            errorOverlay.visibility = View.GONE
        }
    }

    private fun showSettingsDialog() {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(14), dp(20), dp(6))
        }

        val cloudLabel = TextView(this).apply {
            text = "24h 云端地址 (AWS)"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setTextColor(Color.parseColor("#94A3B8"))
        }
        val cloudInput = EditText(this).apply {
            setText(getCloudUrl())
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            isSingleLine = true
        }

        val homeLabel = TextView(this).apply {
            text = "家里电脑地址 (Windows)"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setTextColor(Color.parseColor("#94A3B8"))
            setPadding(0, dp(12), 0, 0)
        }
        val homeInput = EditText(this).apply {
            setText(getHomeUrl())
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            isSingleLine = true
        }

        container.addView(cloudLabel)
        container.addView(cloudInput)
        container.addView(homeLabel)
        container.addView(homeInput)

        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("节点地址设置")
            .setView(container)
            .setPositiveButton("保存并刷新") { _, _ ->
                val newCloud = cloudInput.text.toString().trim().trimEnd('/')
                val newHome = homeInput.text.toString().trim().trimEnd('/')
                if (!newCloud.startsWith("https://") || !newHome.startsWith("https://")) {
                    Toast.makeText(this, "请输入以 https:// 开头的完整地址", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit()
                    .putString(KEY_CLOUD_URL, newCloud)
                    .putString(KEY_HOME_URL, newHome)
                    .apply()
                cloudWebView?.loadUrl(newCloud)
                homeWebView?.loadUrl(newHome)
                Toast.makeText(this, "节点地址已更新", Toast.LENGTH_SHORT).show()
            }
            .setNeutralButton("清除登录缓存") { _, _ ->
                CookieManager.getInstance().removeAllCookies {
                    CookieManager.getInstance().flush()
                    runOnUiThread {
                        cloudWebView?.clearCache(true)
                        homeWebView?.clearCache(true)
                        reloadActiveNode()
                        Toast.makeText(this, "已清除缓存，请重新验证邮箱", Toast.LENGTH_SHORT).show()
                    }
                }
            }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun isInAppHost(host: String?): Boolean {
        val h = host?.lowercase() ?: return false
        val cloudHost = Uri.parse(getCloudUrl()).host?.lowercase()
        val homeHost = Uri.parse(getHomeUrl()).host?.lowercase()
        return h == cloudHost ||
            h == homeHost ||
            h.endsWith(".cloudflareaccess.com") ||
            h == "cloudflareaccess.com" ||
            h.endsWith(".cloudflare.com")
    }

    private fun openExternalUri(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: Exception) {
            Toast.makeText(this, "无法打开外部链接", Toast.LENGTH_SHORT).show()
        }
    }

    private fun getActiveWebView(): WebView? {
        return if (activeNode == NODE_CLOUD) cloudWebView else homeWebView
    }

    private fun getCloudUrl(): String {
        return getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .getString(KEY_CLOUD_URL, DEFAULT_CLOUD_URL) ?: DEFAULT_CLOUD_URL
    }

    private fun getHomeUrl(): String {
        return getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .getString(KEY_HOME_URL, DEFAULT_HOME_URL) ?: DEFAULT_HOME_URL
    }

    private fun dp(value: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics
        ).toInt()
    }

    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            val result = WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            filePathCallback?.onReceiveValue(result)
            filePathCallback = null
        }
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        val wv = getActiveWebView()
        if (wv != null && wv.canGoBack()) {
            wv.goBack()
            return
        }
        val now = System.currentTimeMillis()
        if (now - lastBackPressedAt < 2000L) {
            finish()
        } else {
            lastBackPressedAt = now
            Toast.makeText(this, "再按一次退出 RelayDeck", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        cloudWebView?.destroy()
        homeWebView?.destroy()
        cloudWebView = null
        homeWebView = null
        super.onDestroy()
    }
}
