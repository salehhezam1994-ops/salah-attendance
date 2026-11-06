package app.manara.knowledge;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import androidx.core.content.ContextCompat;

/**
 * "Ask Manara" entry in Android's text-selection menu (ACTION_PROCESS_TEXT).
 * Only the text the user selected and chose to send is used. Opens the floating
 * companion if allowed, otherwise the full app — then finishes immediately.
 */
public class AskManaraActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String text = ManaraLinks.sharedText(getIntent());
        String origin = ManaraLinks.origin(this);
        if (text != null && origin != null && Settings.canDrawOverlays(this)) {
            Intent i = new Intent(this, FloatingService.class);
            i.putExtra(FloatingService.EXTRA_URL, ManaraLinks.shareUrl(origin, text, true));
            ContextCompat.startForegroundService(this, i);
        } else {
            Intent open = new Intent(this, MainActivity.class);
            open.setAction(Intent.ACTION_SEND);
            open.setType("text/plain");
            if (text != null) open.putExtra(Intent.EXTRA_TEXT, text);
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(open);
        }
        finish();
    }
}
