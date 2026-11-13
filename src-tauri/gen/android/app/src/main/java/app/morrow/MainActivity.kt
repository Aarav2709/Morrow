package app.morrow

import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  companion object {
    // what another app shared with morrow, kept until the page asks for it
    var shared: String? = null
  }

  // a link shared from the browser or another app, with the title it gave it on the line above
  private fun keepShared(intent: Intent?) {
    if (intent?.action != Intent.ACTION_SEND || intent.type?.startsWith("text/") != true) return
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
