package app.morrow

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.core.view.WindowCompat
import app.tauri.PermissionState
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class FolderArgs {
  var path: String = ""
}

@InvokeArg
class ThemeArgs {
  var dark: Boolean = false
  var color: String = "#f8f8f7"
}

// the parts of morrow that only android can answer: reading folders outside the app's own storage, picking
// one of them, the phone's name, and the colour behind the status bar
@TauriPlugin(
  permissions = [
    Permission(
      strings = [Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE],
      alias = "storage"
    ),
    Permission(strings = [Manifest.permission.ACCESS_LOCAL_NETWORK], alias = "localNetwork")
  ]
)
class DevicePlugin(private val activity: Activity) : Plugin(activity) {
  // android 11 and later have one switch for every file, earlier ones ask for storage like any permission
  private fun granted(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Environment.isExternalStorageManager()
    else getPermissionState("storage") == PermissionState.GRANTED

  private fun answer(invoke: Invoke) {
    val result = JSObject()
    result.put("granted", granted())
    invoke.resolve(result)
  }

  @Command
  fun storageAccess(invoke: Invoke) = answer(invoke)

  @Command
  fun requestStorageAccess(invoke: Invoke) {
    if (granted()) return answer(invoke)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      return requestPermissionForAlias("storage", invoke, "storagePermissionResult")
    }
    try {
      val own = Intent(
        Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
        Uri.parse("package:" + activity.packageName)
      )
      startActivityForResult(invoke, own, "storageSettingsResult")
    } catch (ex: Exception) {
      // some phones only have the list of every app
      try {
        startActivityForResult(
          invoke,
          Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION),
          "storageSettingsResult"
        )
      } catch (inner: Exception) {
        invoke.reject(inner.message ?: "Could not open the settings for file access.")
      }
    }
  }

  @ActivityCallback
  fun storageSettingsResult(invoke: Invoke, result: ActivityResult) = answer(invoke)

  @PermissionCallback
  fun storagePermissionResult(invoke: Invoke) = answer(invoke)

  // android 17 lets an app reach other devices on the network only once it is allowed to, earlier ones always
  private fun localNetworkGranted(): Boolean =
    Build.VERSION.SDK_INT < 37 || getPermissionState("localNetwork") == PermissionState.GRANTED

  private fun answerLocalNetwork(invoke: Invoke) {
    val result = JSObject()
    result.put("granted", localNetworkGranted())
    invoke.resolve(result)
  }

  private var multicast: WifiManager.MulticastLock? = null

  // without it the phone drops the broadcasts other devices send to say where they are
  private fun holdMulticast() {
    if (multicast?.isHeld == true) return
    try {
      val wifi = activity.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
      multicast = wifi?.createMulticastLock("morrow-sync")?.apply {
        setReferenceCounted(false)
        acquire()
      }
    } catch (ex: Exception) {
      // pairing by address still works without it
    }
  }

  @Command
  fun localNetworkAccess(invoke: Invoke) = answerLocalNetwork(invoke)

  @Command
  fun requestLocalNetworkAccess(invoke: Invoke) {
    holdMulticast()
    if (localNetworkGranted()) return answerLocalNetwork(invoke)
    requestPermissionForAlias("localNetwork", invoke, "localNetworkResult")
  }

  @PermissionCallback
  fun localNetworkResult(invoke: Invoke) = answerLocalNetwork(invoke)

  @Command
  fun pickFolder(invoke: Invoke) {
    try {
      startActivityForResult(invoke, Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), "pickFolderResult")
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "Could not open the folder picker.")
    }
  }

  @ActivityCallback
  fun pickFolderResult(invoke: Invoke, result: ActivityResult) {
    val result_ = JSObject()
    val uri = if (result.resultCode == Activity.RESULT_OK) result.data?.data else null
    if (uri == null) {
      invoke.resolve(result_)
      return
    }
    try {
      // the picker answers with an id like primary:Documents/Notes, which is a plain folder on the phone
      val id = DocumentsContract.getTreeDocumentId(uri)
      val volume = id.substringBefore(':')
      val rest = id.substringAfter(':', "")
      val root = when {
        volume.equals("primary", ignoreCase = true) -> Environment.getExternalStorageDirectory().absolutePath
        volume.equals("home", ignoreCase = true) ->
          Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS).absolutePath
        uri.authority == "com.android.externalstorage.documents" -> "/storage/$volume"
        else -> null
      }
      if (root == null) {
        result_.put("unsupported", true)
      } else {
        result_.put("path", if (rest.isEmpty()) root else "$root/$rest")
      }
      invoke.resolve(result_)
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "Could not read the folder that was picked.")
    }
  }

  // a folder on the phone opened in its file manager. folders inside morrow's own storage can't be shown
  // by other apps, those answer that it is private
  @Command
  fun openFolder(invoke: Invoke) {
    val args = invoke.parseArgs(FolderArgs::class.java)
    val result = JSObject()
    val file = java.io.File(args.path)
    val folder = (if (file.isDirectory) file else file.parentFile)?.absolutePath ?: args.path
    val root = Environment.getExternalStorageDirectory().absolutePath
    if (!folder.startsWith(root)) {
      result.put("opened", false)
      result.put("private", true)
      invoke.resolve(result)
      return
    }
    val relative = folder.removePrefix(root).trimStart('/')
    val uri = DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:$relative")
    val tries = listOf(
      Intent(Intent.ACTION_VIEW).setDataAndType(uri, DocumentsContract.Document.MIME_TYPE_DIR),
      Intent(Intent.ACTION_VIEW, uri),
      Intent("android.provider.action.BROWSE", uri)
    )
    var opened = false
    for (intent in tries) {
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        activity.startActivity(intent)
        opened = true
        break
      } catch (ex: Exception) {
        // the next way of asking, some file managers only answer one of them
      }
    }
    result.put("opened", opened)
    result.put("private", false)
    invoke.resolve(result)
  }

  // the phone's own documents folder, where new vaults go once morrow may keep files outside its storage
  @Command
  fun documentsFolder(invoke: Invoke) {
    val result = JSObject()
    result.put(
      "path",
      Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS).absolutePath
    )
    invoke.resolve(result)
  }

  // what was shared with morrow from another app since the page last asked, once
  @Command
  fun takeShared(invoke: Invoke) {
    val result = JSObject()
    result.put("text", MainActivity.shared)
    MainActivity.shared = null
    val files = app.tauri.plugin.JSArray()
    MainActivity.sharedFiles.forEach { files.put(it) }
    MainActivity.sharedFiles.clear()
    result.put("files", files)
    invoke.resolve(result)
  }

  @Command
  fun deviceName(invoke: Invoke) {
    val result = JSObject()
    val name = try {
      Settings.Global.getString(activity.contentResolver, Settings.Global.DEVICE_NAME)
    } catch (ex: Exception) {
      null
    }
    result.put("name", if (name.isNullOrBlank()) Build.MODEL else name)
    invoke.resolve(result)
  }

  // the strip behind the status bar takes the colour of the page, with icons that can be read on it
  @Command
  fun setTheme(invoke: Invoke) {
    val args = invoke.parseArgs(ThemeArgs::class.java)
    activity.runOnUiThread {
      try {
        val window = activity.window
        window.decorView.setBackgroundColor(Color.parseColor(args.color))
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = !args.dark
        controller.isAppearanceLightNavigationBars = !args.dark
      } catch (ex: Exception) {
        // the colour is only looks, the app carries on without it
      }
    }
    invoke.resolve()
  }
}
