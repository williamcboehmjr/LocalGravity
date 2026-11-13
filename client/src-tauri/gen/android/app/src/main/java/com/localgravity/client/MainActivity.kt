package com.localgravity.client

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.view.View
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private fun applySafeAreaInsets(target: View) {
    target.setBackgroundColor(Color.parseColor("#101012"))
    ViewCompat.setOnApplyWindowInsetsListener(target) { view, windowInsets ->
      val insets = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars()
          or WindowInsetsCompat.Type.displayCutout()
          or WindowInsetsCompat.Type.ime()
      )
      view.setPadding(insets.left, insets.top, insets.right, insets.bottom)
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(target)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    WindowCompat.setDecorFitsSystemWindows(window, false)
    @Suppress("DEPRECATION")
    window.statusBarColor = Color.parseColor("#101012")
    @Suppress("DEPRECATION")
    window.navigationBarColor = Color.parseColor("#101012")

    val rootView: View = findViewById(android.R.id.content)
    applySafeAreaInsets(rootView)

    val controller = WindowCompat.getInsetsController(window, window.decorView)
    controller.isAppearanceLightStatusBars = false
    controller.isAppearanceLightNavigationBars = false

    val permsToRequest = mutableListOf("android.permission.ACCESS_LOCAL_NETWORK")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      permsToRequest.add(Manifest.permission.READ_MEDIA_IMAGES)
      permsToRequest.add(Manifest.permission.READ_MEDIA_VIDEO)
      permsToRequest.add(Manifest.permission.READ_MEDIA_AUDIO)
    } else {
      permsToRequest.add(Manifest.permission.READ_EXTERNAL_STORAGE)
    }

    val missingPerms = permsToRequest.filter {
      ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
    }
    if (missingPerms.isNotEmpty()) {
      ActivityCompat.requestPermissions(this, missingPerms.toTypedArray(), 1001)
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && !Environment.isExternalStorageManager()) {
      try {
        val intent = Intent(
          Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
          Uri.parse("package:$packageName")
        )
        startActivity(intent)
      } catch (_: Exception) {
        try {
          startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
        } catch (_: Exception) {
        }
      }
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    val rootView: View = findViewById(android.R.id.content)
    applySafeAreaInsets(rootView)
  }
}
