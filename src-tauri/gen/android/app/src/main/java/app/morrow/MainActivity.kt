package app.morrow

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import java.io.File
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  companion object {
    // what another app shared with morrow, kept until the page asks for it
    var shared: String? = null
    // files shared with morrow, such as a pdf, copied into its cache until the page takes them
    val sharedFiles = mutableListOf<String>()
    private const val MAX_SHARED_BYTES = 100L * 1024 * 1024
  }

  // the name the sharing app gave the file, or the end of its address
  private fun nameOf(uri: Uri): String {
    try {
      contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          val name = cursor.getString(0)
          if (!name.isNullOrBlank()) return name
        }
      }
    } catch (ex: Exception) {
      // some apps share files without a name
    }
    return uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.isNotBlank() } ?: "file"
  }

  // each shared file is copied into morrow's cache, the sharing app's permission to read it ends soon after
  private fun keepFile(uri: Uri) {
    try {
      val folder = File(cacheDir, "shared").apply { mkdirs() }
      val name = nameOf(uri).replace(Regex("[\\\\/:*?\"<>|]"), "_").take(120)
      var target = File(folder, name)
      var n = 2
      while (target.exists()) target = File(folder, "${n++} $name")
      var copied = 0L
      contentResolver.openInputStream(uri)?.use { input ->
        target.outputStream().use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            copied += read
            if (copied > MAX_SHARED_BYTES) throw IllegalStateException("too large")
            output.write(buffer, 0, read)
          }
        }
      } ?: return
      sharedFiles.add(target.absolutePath)
    } catch (ex: Exception) {
      // a file that can't be read is left out, the rest still arrive
    }
  }

  @Suppress("DEPRECATION")
  private fun streams(intent: Intent): List<Uri> =
    when (intent.action) {
      Intent.ACTION_SEND ->
        listOfNotNull(
          if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
          else intent.getParcelableExtra(Intent.EXTRA_STREAM)
        )
      Intent.ACTION_SEND_MULTIPLE ->
        (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)).orEmpty()
      else -> emptyList()
    }

  // a link shared from the browser or another app, with the title it gave it on the line above
  private fun keepShared(intent: Intent?) {
    if (intent == null) return
    val files = streams(intent)
    if (files.isNotEmpty()) {
      files.take(20).forEach(::keepFile)
      return
    }
    if (intent.action != Intent.ACTION_SEND || intent.type?.startsWith("text/") != true) return
    val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty()
    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim().orEmpty()
    if (text.isEmpty() && subject.isEmpty()) return
    shared = if (subject.isNotEmpty() && !text.contains(subject)) "$subject\n$text".trim() else text
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    keepShared(intent)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    keepShared(intent)
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // android draws the app under the status bar, the navigation bar and the keyboard. the page is kept
    // out from under all three and clear of the notch, so the top bar can be tapped and the line being
    // typed stays in view. the strips left over take the page's colour, see DevicePlugin.setTheme
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or
          WindowInsetsCompat.Type.ime()
      )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }
}
